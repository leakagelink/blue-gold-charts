ALTER TABLE public.deposit_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

CREATE INDEX IF NOT EXISTS idx_deposit_requests_deleted_at ON public.deposit_requests(deleted_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_deleted_at ON public.withdrawal_requests(deleted_at);