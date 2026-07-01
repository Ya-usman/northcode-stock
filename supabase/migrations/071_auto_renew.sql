-- Auto-renewal columns on subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS auto_renew              boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gateway                 text,
  ADD COLUMN IF NOT EXISTS gateway_authorization   text,
  ADD COLUMN IF NOT EXISTS gateway_email           text,
  ADD COLUMN IF NOT EXISTS gateway_last4           text,
  ADD COLUMN IF NOT EXISTS renewal_failures        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_renewal_attempt_at timestamptz;
