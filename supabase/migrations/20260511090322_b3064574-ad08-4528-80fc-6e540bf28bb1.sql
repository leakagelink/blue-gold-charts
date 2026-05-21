
-- Add momentum tracking columns to positions
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS momentum_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS momentum_target_price numeric,
  ADD COLUMN IF NOT EXISTS momentum_direction text;

-- Enable required extensions for cron-based momentum drift
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Server-side function that drifts each edited+active position toward its target.
-- When target is reached, picks a new random target in the same direction (1%-5% further).
CREATE OR REPLACE FUNCTION public.drift_edited_positions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pos RECORD;
  step numeric;
  new_price numeric;
  reached boolean;
  new_target numeric;
  pct numeric;
  price_diff numeric;
  new_pnl numeric;
BEGIN
  FOR pos IN
    SELECT * FROM public.positions
    WHERE status = 'open'
      AND price_mode = 'edited'
      AND momentum_active = true
      AND momentum_target_price IS NOT NULL
      AND momentum_direction IN ('up','down')
  LOOP
    -- Move ~8% of the remaining gap each tick (smooth drift)
    step := (pos.momentum_target_price - pos.current_price) * 0.08;
    new_price := pos.current_price + step;

    -- Detect target reached (within 0.05% of target)
    reached := abs(pos.momentum_target_price - new_price) <= abs(pos.momentum_target_price) * 0.0005;

    IF reached THEN
      new_price := pos.momentum_target_price;
      -- Pick next random target 1%-5% further in the same direction
      pct := (1 + random() * 4) / 100.0; -- 0.01..0.05
      IF pos.momentum_direction = 'up' THEN
        new_target := new_price * (1 + pct);
      ELSE
        new_target := new_price * (1 - pct);
      END IF;
    ELSE
      new_target := pos.momentum_target_price;
    END IF;

    -- Recalculate PnL with the new current price
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
    WHERE id = pos.id;
  END LOOP;
END;
$$;

-- Schedule the drift function every 5 seconds via pg_cron
-- Using 5-second cadence: cron supports per-second via 'X seconds' syntax
DO $$
BEGIN
  -- Remove existing job if present
  PERFORM cron.unschedule('drift-edited-positions-5s')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'drift-edited-positions-5s');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'drift-edited-positions-5s',
  '5 seconds',
  $$ SELECT public.drift_edited_positions(); $$
);
