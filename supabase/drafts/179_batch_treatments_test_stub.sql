-- 179 — schéma MINIMAL pour une base PostgreSQL LOCALE jetable (jamais la production) — BROUILLON DE TEST
-- Utilisé par 179_batch_treatments_local_validation.sh avant la migration, ses tests et son retour arrière.
-- Schéma MINIMAL (base locale jetable) reproduisant ce que la 179 touche en production : mêmes noms de tables,
-- colonnes utilisées, clés et règles de suppression (relues en production le 24 oct. 2026), schéma storage
-- et rôles Supabase. Sert uniquement à exécuter la migration, ses scénarios et son retour arrière.
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, country text, timezone text NOT NULL DEFAULT 'Africa/Douala', deleted_at timestamptz);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text);
CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, name text, deleted_at timestamptz);
CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  name text, quantity int NOT NULL DEFAULT 0, buying_price numeric, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT now());
CREATE TABLE public.product_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE, supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  quantity int NOT NULL CHECK (quantity >= 0), initial_quantity int NOT NULL, buying_price numeric, expiry_date date, source text NOT NULL DEFAULT 'restock',
  received_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  sale_number text, sale_status text DEFAULT 'active', created_at timestamptz DEFAULT now(), review_reason text, reviewed_at timestamptz, cashier_id uuid);
CREATE TABLE public.sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, quantity int NOT NULL, stock_shortfall int NOT NULL DEFAULT 0,
  batch_unallocated int NOT NULL DEFAULT 0);
CREATE TABLE public.sale_item_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE CASCADE,
  batch_id uuid, quantity int NOT NULL, created_at timestamptz DEFAULT now(),
  CONSTRAINT sale_item_batches_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE SET NULL);
CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, type text CHECK (type IN ('in', 'out', 'adjustment', 'sale')),
  quantity int NOT NULL, previous_qty int, new_qty int, reason text, notes text, performed_by uuid, created_at timestamptz DEFAULT now());
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
-- Fonctions existantes en production dont la 179 dépend ou qu'elle remplace
CREATE FUNCTION public.shop_business_date(p_shop_id uuid, p_at timestamptz DEFAULT now()) RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (coalesce(p_at, now()) AT TIME ZONE (SELECT timezone FROM public.shops WHERE id = p_shop_id))::date $$;
CREATE FUNCTION public.adjust_batch_quantity(p_batch_id uuid, p_shop_id uuid, p_new_quantity integer, p_reason_code text, p_performed_by uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
GRANT EXECUTE ON FUNCTION public.adjust_batch_quantity(uuid, uuid, integer, text, uuid) TO service_role;
CREATE FUNCTION public.delete_product_batch(p_batch_id uuid, p_shop_id uuid, p_reason_code text, p_performed_by uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
-- Supabase donne par défaut des droits sur les nouvelles tables : reproduit pour vérifier le REVOKE de la 179
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
