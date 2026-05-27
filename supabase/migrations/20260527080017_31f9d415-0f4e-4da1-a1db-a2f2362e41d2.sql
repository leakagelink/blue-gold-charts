
-- Add brokerage to transaction_type enum
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'brokerage';

-- Add brokerage tracking column on positions
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS brokerage NUMERIC NOT NULL DEFAULT 0;

-- Seed default brokerage % (per side) if not present
INSERT INTO public.payment_settings (setting_key, setting_value)
VALUES ('brokerage_percentage', '0.05')
ON CONFLICT (setting_key) DO NOTHING;
