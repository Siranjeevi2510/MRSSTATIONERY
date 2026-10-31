create extension if not exists pgcrypto;
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null,
  category text,
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  reorder_level integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  subtotal numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_method text not null default 'cash',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  sku text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  line_total numeric(12,2) not null
);
alter table public.products enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
create policy "Authenticated users can read products" on public.products for select to authenticated using (true);
create policy "Authenticated users can manage products" on public.products for all to authenticated using (true) with check (true);
create policy "Authenticated users can read sales" on public.sales for select to authenticated using (true);
create policy "Authenticated users can create sales" on public.sales for insert to authenticated with check (true);
create policy "Authenticated users can read sale items" on public.sale_items for select to authenticated using (true);
create policy "Authenticated users can create sale items" on public.sale_items for insert to authenticated with check (true);
