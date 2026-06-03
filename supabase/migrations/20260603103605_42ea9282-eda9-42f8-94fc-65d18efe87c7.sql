ALTER TABLE public.positions
ADD COLUMN IF NOT EXISTS edited_pnl_anchor numeric,
ADD COLUMN IF NOT EXISTS momentum_target_pnl_percent numeric;

CREATE OR REPLACE FUNCTION public.drift_edited_positions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pos RECORD;
  anchor_pnl numeric;
  anchor_pnl_percent numeric;
  target_pnl_percent numeric;
  current_pnl_percent numeric;
  next_pnl_percent numeric;
  new_target_pnl_percent numeric;
  new_direction text;
  distance numeric;
  step numeric;
  jitter numeric;
  quantity numeric;
  new_pnl numeric;
  new_price numeric;
  band_pct numeric;
BEGIN
  -- Bootstrap edited trades. The anchor is the broker-set PnL value.
  UPDATE public.positions p
  SET
    momentum_active = true,
    edited_pnl_anchor = COALESCE(p.edited_pnl_anchor, p.pnl, 0),
    momentum_direction = COALESCE(
      NULLIF(p.momentum_direction, ''),
      CASE WHEN random() < 0.5 THEN 'up' ELSE 'down' END
    ),
    momentum_target_pnl_percent = COALESCE(
      p.momentum_target_pnl_percent,
      CASE
        WHEN COALESCE(NULLIF(p.momentum_direction, ''), CASE WHEN random() < 0.5 THEN 'up' ELSE 'down' END) = 'up'
          THEN ((COALESCE(p.edited_pnl_anchor, p.pnl, 0) / NULLIF(p.margin, 0)) * 100) + (1 + random() * 4)
        ELSE ((COALESCE(p.edited_pnl_anchor, p.pnl, 0) / NULLIF(p.margin, 0)) * 100) - (1 + random() * 4)
      END
    )
  WHERE p.status = 'open'
    AND p.price_mode = 'edited'
    AND (
      p.momentum_active IS NOT TRUE
      OR p.edited_pnl_anchor IS NULL
      OR p.momentum_target_pnl_percent IS NULL
      OR p.momentum_direction IS NULL
      OR p.momentum_direction NOT IN ('up','down')
    );

  FOR pos IN
    SELECT * FROM public.positions
    WHERE status = 'open'
      AND price_mode = 'edited'
      AND momentum_active = true
      AND momentum_direction IN ('up','down')
      AND margin > 0
  LOOP
    quantity := CASE
      WHEN COALESCE(pos.amount, 0) > 0 THEN pos.amount
      WHEN COALESCE(pos.margin, 0) > 0 AND COALESCE(pos.leverage, 0) > 0 AND COALESCE(pos.entry_price, 0) > 0
        THEN (pos.margin * pos.leverage) / pos.entry_price
      ELSE 0
    END;

    IF quantity <= 0 THEN
      CONTINUE;
    END IF;

    anchor_pnl := COALESCE(pos.edited_pnl_anchor, pos.pnl, 0);
    anchor_pnl_percent := (anchor_pnl / pos.margin) * 100;
    current_pnl_percent := (COALESCE(pos.pnl, anchor_pnl) / pos.margin) * 100;
    target_pnl_percent := COALESCE(
      pos.momentum_target_pnl_percent,
      anchor_pnl_percent + CASE WHEN pos.momentum_direction = 'up' THEN 1 + random() * 4 ELSE -(1 + random() * 4) END
    );

    -- Clamp stale/invalid targets so edited trades always stay within 1%-5% around the broker-set PnL%.
    IF abs(target_pnl_percent - anchor_pnl_percent) < 1
       OR abs(target_pnl_percent - anchor_pnl_percent) > 5 THEN
      band_pct := 1 + random() * 4;
      target_pnl_percent := anchor_pnl_percent + CASE WHEN pos.momentum_direction = 'up' THEN band_pct ELSE -band_pct END;
    END IF;

    distance := target_pnl_percent - current_pnl_percent;
    step := distance * 0.35;
    jitter := (random() - 0.5) * 0.12;
    next_pnl_percent := current_pnl_percent + step + jitter;

    -- Never allow the tick to break the broker-set ±5% band.
    next_pnl_percent := LEAST(anchor_pnl_percent + 5, GREATEST(anchor_pnl_percent - 5, next_pnl_percent));

    IF abs(target_pnl_percent - next_pnl_percent) <= 0.08 THEN
      next_pnl_percent := target_pnl_percent;
      new_direction := CASE WHEN pos.momentum_direction = 'up' THEN 'down' ELSE 'up' END;
      band_pct := 1 + random() * 4;
      new_target_pnl_percent := anchor_pnl_percent + CASE WHEN new_direction = 'up' THEN band_pct ELSE -band_pct END;
    ELSE
      new_direction := pos.momentum_direction;
      new_target_pnl_percent := target_pnl_percent;
    END IF;

    new_pnl := (next_pnl_percent / 100) * pos.margin;

    IF pos.position_type = 'long' THEN
      new_price := pos.entry_price + (new_pnl / quantity);
    ELSE
      new_price := pos.entry_price - (new_pnl / quantity);
    END IF;

    new_price := GREATEST(0.0001, new_price);

    UPDATE public.positions
    SET current_price = new_price,
        pnl = new_pnl,
        edited_pnl_anchor = anchor_pnl,
        momentum_direction = new_direction,
        momentum_target_pnl_percent = new_target_pnl_percent,
        momentum_target_price = new_price,
        updated_at = now()
    WHERE id = pos.id
      AND status = 'open'
      AND price_mode = 'edited';
  END LOOP;
END;
$function$;

-- Bring currently open edited trades into the corrected controlled band immediately.
SELECT public.drift_edited_positions();