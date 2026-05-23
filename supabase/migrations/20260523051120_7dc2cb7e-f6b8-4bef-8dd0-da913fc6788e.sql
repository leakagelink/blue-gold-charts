
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Faster, MT5-style momentum: bigger step per tick + smaller "reached" tolerance
CREATE OR REPLACE FUNCTION public.drift_edited_positions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  pos RECORD;
  step numeric;
  new_price numeric;
  reached boolean;
  new_target numeric;
  pct numeric;
  price_diff numeric;
  new_pnl numeric;
  jitter numeric;
BEGIN
  -- Bootstrap any edited position that's missing momentum metadata
  UPDATE public.positions p
  SET
    momentum_active = true,
    momentum_direction = COALESCE(
      p.momentum_direction,
      CASE WHEN p.position_type = 'long' THEN 'up' ELSE 'down' END
    ),
    momentum_target_price = COALESCE(
      p.momentum_target_price,
      CASE
        WHEN COALESCE(p.position_type::text,'long') = 'long'
          THEN p.current_price * (1 + ((0.3 + random() * 1.2) / 100.0))
        ELSE p.current_price * (1 - ((0.3 + random() * 1.2) / 100.0))
      END
    )
  WHERE p.status = 'open'
    AND p.price_mode = 'edited'
    AND (
      p.momentum_active IS NOT TRUE
      OR p.momentum_target_price IS NULL
      OR p.momentum_direction IS NULL
      OR p.momentum_direction NOT IN ('up','down')
    );

  FOR pos IN
    SELECT * FROM public.positions
    WHERE status = 'open'
      AND price_mode = 'edited'
      AND momentum_active = true
      AND momentum_target_price IS NOT NULL
      AND momentum_direction IN ('up','down')
  LOOP
    -- MT5-style fast tick: move 25% of remaining distance each second
    -- plus a small random jitter so the chart never looks frozen
    step := (pos.momentum_target_price - pos.current_price) * 0.25;
    jitter := pos.current_price * ((random() - 0.5) * 0.0006); -- ±0.03%
    new_price := pos.current_price + step + jitter;

    reached := abs(pos.momentum_target_price - new_price) <= abs(pos.momentum_target_price) * 0.0008;

    IF reached THEN
      new_price := pos.momentum_target_price;
      -- Pick a fresh nearby target (0.3% - 1.5%) so movement continues smoothly
      pct := (0.3 + random() * 1.2) / 100.0;
      IF pos.momentum_direction = 'up' THEN
        new_target := new_price * (1 + pct);
      ELSE
        new_target := new_price * (1 - pct);
      END IF;
    ELSE
      new_target := pos.momentum_target_price;
    END IF;

    IF pos.position_type = 'long' THEN
      price_diff := new_price - pos.entry_price;
    ELSE
      price_diff := pos.entry_price - new_price;
    END IF;
    new_pnl := price_diff * pos.amount;

    UPDATE public.positions
    SET current_price = new_price,
        momentum_target_price = new_target,
        pnl = new_pnl,
        updated_at = now()
    WHERE id = pos.id
      AND status = 'open'
      AND price_mode = 'edited';
  END LOOP;
END;
$function$;

-- Remove any prior schedule for this job
DO $$
DECLARE j RECORD;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'drift-edited-positions' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

-- Run momentum every 1 second (MT5-like ticker)
SELECT cron.schedule(
  'drift-edited-positions',
  '1 seconds',
  $$SELECT public.drift_edited_positions();$$
);
