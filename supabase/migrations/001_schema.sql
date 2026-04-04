-- ============================================================
-- NorthCode Stock Manager — Full Database Schema + RLS
-- Run this in Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable required extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pg_cron";
create extension if not exists "pg_net";

-- ============================================================
-- TABLES
-- ============================================================

-- SHOPS (create before profiles due to FK)
create table if not exists shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users on delete set null,
  city text not null,
  state text not null,
  whatsapp text,
  logo_url text,
  currency text default '₦',
  low_stock_threshold int default 10,
  tax_rate numeric default 0,
  notify_whatsapp_low_stock boolean default true,
  notify_whatsapp_daily boolean default true,
  notify_whatsapp_each_sale boolean default false,
  notify_email_low_stock boolean default true,
  notify_email_daily boolean default true,
  created_at timestamptz default now()
);

-- PROFILES (extends auth.users)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text not null,
  role text not null check (role in ('owner','cashier','stock_manager','viewer')),
  shop_id uuid references shops(id) on delete set null,
  phone text,
  is_active boolean default true,
  last_seen timestamptz,
  created_at timestamptz default now()
);

-- CATEGORIES
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  name text not null,
  name_hausa text,
  created_at timestamptz default now()
);

-- SUPPLIERS
create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  name text not null,
  phone text,
  city text,
  created_at timestamptz default now()
);

-- PRODUCTS
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  name text not null,
  name_hausa text,
  sku text,
  category_id uuid references categories(id) on delete set null,
  supplier_id uuid references suppliers(id) on delete set null,
  buying_price numeric not null default 0,
  selling_price numeric not null,
  quantity int not null default 0,
  unit text default 'piece',
  low_stock_threshold int,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint products_sku_shop_unique unique (sku, shop_id)
);

-- CUSTOMERS
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  name text not null,
  phone text,
  city text,
  total_debt numeric default 0,
  created_at timestamptz default now()
);

-- SALES
create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  sale_number text,
  customer_id uuid references customers(id) on delete set null,
  cashier_id uuid references auth.users on delete set null,
  subtotal numeric not null,
  discount numeric default 0,
  tax numeric default 0,
  total numeric not null,
  payment_method text check (payment_method in ('cash','transfer','credit','paystack')),
  payment_status text check (payment_status in ('paid','pending','partial')) default 'paid',
  amount_paid numeric not null,
  balance numeric generated always as (total - amount_paid) stored,
  paystack_reference text,
  notes text,
  created_at timestamptz default now(),
  constraint sales_number_shop_unique unique (sale_number, shop_id)
);

-- SALE ITEMS
create table if not exists sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  product_name text not null,
  quantity int not null,
  unit_price numeric not null,
  subtotal numeric generated always as (quantity * unit_price) stored
);

-- PAYMENTS (partial / credit repayments)
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references sales(id) on delete cascade,
  amount numeric not null,
  method text not null,
  reference text,
  received_by uuid references auth.users on delete set null,
  paid_at timestamptz default now()
);

-- STOCK MOVEMENTS
create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  type text check (type in ('in','out','adjustment','sale')),
  quantity int not null,
  reason text,
  notes text,
  performed_by uuid references auth.users on delete set null,
  created_at timestamptz default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_products_shop_id on products(shop_id);
create index if not exists idx_products_category_id on products(category_id);
create index if not exists idx_products_is_active on products(is_active);
create index if not exists idx_sales_shop_id on sales(shop_id);
create index if not exists idx_sales_created_at on sales(created_at desc);
create index if not exists idx_sales_cashier_id on sales(cashier_id);
create index if not exists idx_sale_items_sale_id on sale_items(sale_id);
create index if not exists idx_sale_items_product_id on sale_items(product_id);
create index if not exists idx_stock_movements_shop_id on stock_movements(shop_id);
create index if not exists idx_stock_movements_product_id on stock_movements(product_id);
create index if not exists idx_stock_movements_created_at on stock_movements(created_at desc);
create index if not exists idx_customers_shop_id on customers(shop_id);
create index if not exists idx_payments_sale_id on payments(sale_id);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

create or replace function get_user_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function get_user_shop_id()
returns uuid as $$
  select shop_id from profiles where id = auth.uid();
$$ language sql security definer stable;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-set sale_number before insert
create or replace function set_sale_number()
returns trigger as $$
declare
  shop_prefix text;
  next_num int;
begin
  select upper(substring(name, 1, 3)) into shop_prefix
  from shops where id = new.shop_id;

  select coalesce(count(*), 0) + 1 into next_num
  from sales where shop_id = new.shop_id;

  new.sale_number := shop_prefix || '-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists before_sale_insert on sales;
create trigger before_sale_insert
  before insert on sales
  for each row execute function set_sale_number();

-- Auto-deduct stock and log movement on sale item insert
create or replace function deduct_stock_on_sale()
returns trigger as $$
begin
  -- Deduct product quantity
  update products
  set quantity = quantity - new.quantity,
      updated_at = now()
  where id = new.product_id;

  -- Log stock movement
  insert into stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
  select
    s.shop_id,
    new.product_id,
    'sale',
    new.quantity,
    'Sale ' || s.sale_number,
    s.cashier_id
  from sales s where s.id = new.sale_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists after_sale_item_insert on sale_items;
create trigger after_sale_item_insert
  after insert on sale_items
  for each row execute function deduct_stock_on_sale();

-- Update customer debt on credit sale
create or replace function update_customer_debt_on_sale()
returns trigger as $$
begin
  if new.payment_method = 'credit' and new.customer_id is not null then
    update customers
    set total_debt = total_debt + new.balance
    where id = new.customer_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists after_sale_insert_debt on sales;
create trigger after_sale_insert_debt
  after insert on sales
  for each row execute function update_customer_debt_on_sale();

-- Reduce customer debt when payment recorded
create or replace function update_customer_debt_on_payment()
returns trigger as $$
begin
  update customers c
  set total_debt = greatest(0, c.total_debt - new.amount)
  from sales s
  where s.id = new.sale_id
    and s.customer_id = c.id;

  -- Update sale payment status
  update sales
  set amount_paid = amount_paid + new.amount,
      payment_status = case
        when (amount_paid + new.amount) >= total then 'paid'
        when (amount_paid + new.amount) > 0 then 'partial'
        else 'pending'
      end
  where id = new.sale_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists after_payment_insert on payments;
create trigger after_payment_insert
  after insert on payments
  for each row execute function update_customer_debt_on_payment();

-- Auto-update products.updated_at
create or replace function update_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_products_updated_at on products;
create trigger set_products_updated_at
  before update on products
  for each row execute function update_timestamp();

-- Update last_seen in profiles
create or replace function update_last_seen()
returns trigger as $$
begin
  update profiles set last_seen = now() where id = auth.uid();
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================
-- VIEW: products_public (hides buying_price for non-owners)
-- ============================================================

create or replace view products_public as
select
  id, shop_id, name, name_hausa, sku, category_id, supplier_id,
  case
    when get_user_role() in ('owner') then buying_price
    else null
  end as buying_price,
  selling_price, quantity, unit, low_stock_threshold,
  image_url, is_active, created_at, updated_at
from products;

-- ============================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================

alter table shops enable row level security;
alter table profiles enable row level security;
alter table categories enable row level security;
alter table suppliers enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table payments enable row level security;
alter table stock_movements enable row level security;

-- ============================================================
-- RLS POLICIES — SHOPS
-- ============================================================

drop policy if exists "shops_owner_all" on shops;
create policy "shops_owner_all" on shops
  for all using (
    owner_id = auth.uid() or
    id = get_user_shop_id()
  );

-- ============================================================
-- RLS POLICIES — PROFILES
-- ============================================================

drop policy if exists "profiles_own" on profiles;
create policy "profiles_own" on profiles
  for select using (true); -- everyone can read profiles in their shop via app logic

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert" on profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles_owner_manage" on profiles;
create policy "profiles_owner_manage" on profiles
  for all using (
    get_user_role() = 'owner' and
    shop_id = get_user_shop_id()
  );

-- ============================================================
-- RLS POLICIES — CATEGORIES
-- ============================================================

drop policy if exists "categories_shop_select" on categories;
create policy "categories_shop_select" on categories
  for select using (shop_id = get_user_shop_id());

drop policy if exists "categories_owner_manager_write" on categories;
create policy "categories_owner_manager_write" on categories
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() in ('owner', 'stock_manager')
  );

-- ============================================================
-- RLS POLICIES — SUPPLIERS
-- ============================================================

drop policy if exists "suppliers_shop_select" on suppliers;
create policy "suppliers_shop_select" on suppliers
  for select using (shop_id = get_user_shop_id());

drop policy if exists "suppliers_owner_manager_write" on suppliers;
create policy "suppliers_owner_manager_write" on suppliers
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() in ('owner', 'stock_manager')
  );

-- ============================================================
-- RLS POLICIES — PRODUCTS
-- ============================================================

drop policy if exists "products_shop_select" on products;
create policy "products_shop_select" on products
  for select using (shop_id = get_user_shop_id());

drop policy if exists "products_owner_all" on products;
create policy "products_owner_all" on products
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'owner'
  );

drop policy if exists "products_manager_write" on products;
create policy "products_manager_write" on products
  for insert with check (
    shop_id = get_user_shop_id() and
    get_user_role() = 'stock_manager'
  );

drop policy if exists "products_manager_update" on products;
create policy "products_manager_update" on products
  for update using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'stock_manager'
  );

-- ============================================================
-- RLS POLICIES — CUSTOMERS
-- ============================================================

drop policy if exists "customers_shop_select" on customers;
create policy "customers_shop_select" on customers
  for select using (shop_id = get_user_shop_id());

drop policy if exists "customers_owner_cashier_write" on customers;
create policy "customers_owner_cashier_write" on customers
  for insert with check (
    shop_id = get_user_shop_id() and
    get_user_role() in ('owner', 'cashier')
  );

drop policy if exists "customers_owner_update" on customers;
create policy "customers_owner_update" on customers
  for update using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'owner'
  );

drop policy if exists "customers_owner_delete" on customers;
create policy "customers_owner_delete" on customers
  for delete using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'owner'
  );

-- ============================================================
-- RLS POLICIES — SALES
-- ============================================================

drop policy if exists "sales_owner_all" on sales;
create policy "sales_owner_all" on sales
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'owner'
  );

drop policy if exists "sales_cashier_own" on sales;
create policy "sales_cashier_own" on sales
  for select using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'cashier' and
    cashier_id = auth.uid()
  );

drop policy if exists "sales_cashier_insert" on sales;
create policy "sales_cashier_insert" on sales
  for insert with check (
    shop_id = get_user_shop_id() and
    get_user_role() in ('cashier', 'owner') and
    cashier_id = auth.uid()
  );

drop policy if exists "sales_viewer_select" on sales;
create policy "sales_viewer_select" on sales
  for select using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'viewer'
  );

-- ============================================================
-- RLS POLICIES — SALE ITEMS
-- ============================================================

drop policy if exists "sale_items_owner_all" on sale_items;
create policy "sale_items_owner_all" on sale_items
  for all using (
    get_user_role() = 'owner' and
    exists (
      select 1 from sales s
      where s.id = sale_id and s.shop_id = get_user_shop_id()
    )
  );

drop policy if exists "sale_items_cashier" on sale_items;
create policy "sale_items_cashier" on sale_items
  for all using (
    get_user_role() in ('cashier', 'viewer') and
    exists (
      select 1 from sales s
      where s.id = sale_id and s.shop_id = get_user_shop_id()
    )
  );

-- ============================================================
-- RLS POLICIES — PAYMENTS
-- ============================================================

drop policy if exists "payments_owner_all" on payments;
create policy "payments_owner_all" on payments
  for all using (
    get_user_role() = 'owner' and
    exists (
      select 1 from sales s
      where s.id = sale_id and s.shop_id = get_user_shop_id()
    )
  );

drop policy if exists "payments_cashier_insert" on payments;
create policy "payments_cashier_insert" on payments
  for insert with check (
    get_user_role() in ('cashier') and
    exists (
      select 1 from sales s
      where s.id = sale_id and s.shop_id = get_user_shop_id()
    )
  );

-- ============================================================
-- RLS POLICIES — STOCK MOVEMENTS
-- ============================================================

drop policy if exists "stock_movements_owner_all" on stock_movements;
create policy "stock_movements_owner_all" on stock_movements
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'owner'
  );

drop policy if exists "stock_movements_manager" on stock_movements;
create policy "stock_movements_manager" on stock_movements
  for all using (
    shop_id = get_user_shop_id() and
    get_user_role() = 'stock_manager'
  );

drop policy if exists "stock_movements_system_insert" on stock_movements;
create policy "stock_movements_system_insert" on stock_movements
  for insert with check (
    shop_id = get_user_shop_id()
  );

-- ============================================================
-- ENABLE REALTIME
-- ============================================================

alter publication supabase_realtime add table sales;
alter publication supabase_realtime add table products;
alter publication supabase_realtime add table stock_movements;
alter publication supabase_realtime add table payments;

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

insert into storage.buckets (id, name, public)
values
  ('receipts', 'receipts', true),
  ('product-images', 'product-images', true),
  ('shop-logos', 'shop-logos', true)
on conflict (id) do nothing;

-- Allow authenticated users to upload to their shop's folder
create policy "receipts_insert" on storage.objects
  for insert with check (
    bucket_id = 'receipts' and
    auth.role() = 'authenticated'
  );

create policy "receipts_read" on storage.objects
  for select using (bucket_id = 'receipts');

create policy "product_images_insert" on storage.objects
  for insert with check (
    bucket_id = 'product-images' and
    auth.role() = 'authenticated'
  );

create policy "product_images_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "shop_logos_insert" on storage.objects
  for insert with check (
    bucket_id = 'shop-logos' and
    auth.role() = 'authenticated'
  );

create policy "shop_logos_read" on storage.objects
  for select using (bucket_id = 'shop-logos');
