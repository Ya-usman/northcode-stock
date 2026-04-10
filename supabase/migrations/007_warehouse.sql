-- ============================================================
-- Migration 007 : Warehouse feature REMOVED
-- Drops warehouse/transfer tables if they were created.
-- Safe to run multiple times (IF EXISTS).
-- ============================================================

DROP TABLE IF EXISTS public.delivery_order_items CASCADE;
DROP TABLE IF EXISTS public.delivery_orders CASCADE;
DROP TABLE IF EXISTS public.stock_transfers CASCADE;

ALTER TABLE public.shops DROP COLUMN IF EXISTS is_warehouse;
