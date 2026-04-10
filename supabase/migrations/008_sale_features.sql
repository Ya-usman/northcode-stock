-- ============================================================
-- Migration 008 : Sale cancellation + deletion permissions
-- ============================================================

-- 1. Add cancellation fields to sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_status text NOT NULL DEFAULT 'active'
    CHECK (sale_status IN ('active', 'cancelled'));

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancelled_by   uuid REFERENCES auth.users(id);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS cancel_reason  text;

-- 2. Add delete permission to shop_members
ALTER TABLE public.shop_members
  ADD COLUMN IF NOT EXISTS can_delete_sales boolean NOT NULL DEFAULT false;

-- 3. Index for filtering active/cancelled sales
CREATE INDEX IF NOT EXISTS idx_sales_sale_status ON public.sales(shop_id, sale_status);

-- 4. RLS: cashiers can update sale_status on their own sales (cancel)
--    Owners can update any sale in their shop
--    Done in API routes via admin client, but add policy for completeness.

-- Allow cashier to cancel their own sale (set sale_status='cancelled')
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'cashier_cancel_own_sale' AND tablename = 'sales'
  ) THEN
    CREATE POLICY cashier_cancel_own_sale ON public.sales
      FOR UPDATE
      USING (
        cashier_id = auth.uid()
        AND sale_status = 'active'
        AND created_at >= NOW() - INTERVAL '24 hours'
      )
      WITH CHECK (sale_status = 'cancelled');
  END IF;
END $$;
