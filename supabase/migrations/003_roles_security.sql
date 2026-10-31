-- MRS Stationery role-based access control
-- New accounts default to cashier. Promote the first trusted account to owner manually.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'cashier'
    check (role in ('owner', 'manager', 'cashier')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid()
$$;

revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(user_id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'cashier'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

-- Backfill accounts that already exist before this migration.
insert into public.profiles(user_id, email, display_name, role)
select id, email, split_part(coalesce(email, ''), '@', 1), 'cashier'
from auth.users
on conflict (user_id) do nothing;

alter table public.profiles enable row level security;
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Owners can read all profiles" on public.profiles;
drop policy if exists "Owners can update profiles" on public.profiles;
create policy "Users can read own profile" on public.profiles
for select to authenticated using (user_id = auth.uid());
create policy "Owners can read all profiles" on public.profiles
for select to authenticated using (public.current_user_role() = 'owner');
create policy "Owners can update profiles" on public.profiles
for update to authenticated
using (public.current_user_role() = 'owner')
with check (public.current_user_role() = 'owner');

-- Replace the broad authenticated-user policies from the initial migration.
drop policy if exists "Authenticated users can read products" on public.products;
drop policy if exists "Authenticated users can manage products" on public.products;
drop policy if exists "Products visible to signed-in users" on public.products;
drop policy if exists "Managers can manage products" on public.products;
create policy "Products visible to signed-in users" on public.products
for select to authenticated using (true);
create policy "Managers can manage products" on public.products
for all to authenticated
using (public.current_user_role() in ('owner', 'manager'))
with check (public.current_user_role() in ('owner', 'manager'));

drop policy if exists "Authenticated users can read sales" on public.sales;
drop policy if exists "Authenticated users can create sales" on public.sales;
drop policy if exists "Owner and manager read all sales" on public.sales;
drop policy if exists "Cashiers read own sales" on public.sales;
create policy "Owner and manager read all sales" on public.sales
for select to authenticated
using (public.current_user_role() in ('owner', 'manager'));
create policy "Cashiers read own sales" on public.sales
for select to authenticated
using (created_by = auth.uid());

drop policy if exists "Authenticated users can read sale items" on public.sale_items;
drop policy if exists "Authenticated users can create sale items" on public.sale_items;
drop policy if exists "Users read permitted sale items" on public.sale_items;
create policy "Users read permitted sale items" on public.sale_items
for select to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and (
        public.current_user_role() in ('owner', 'manager')
        or s.created_by = auth.uid()
      )
  )
);

-- Sales and sale_items are written only through the controlled RPC.
revoke insert, update, delete on public.sales from authenticated;
revoke insert, update, delete on public.sale_items from authenticated;

create or replace function public.complete_sale(
  p_items jsonb,
  p_payment_method text default 'cash',
  p_discount_amount numeric default 0,
  p_tax_amount numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_invoice text;
  v_subtotal numeric(12,2) := 0;
  v_total numeric(12,2) := 0;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_price numeric(12,2);
  v_line numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if coalesce(public.current_user_role(), '') not in ('owner', 'manager', 'cashier') then
    raise exception 'Your account does not have a store role';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one sale item is required';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty <= 0 then raise exception 'Quantity must be positive'; end if;
    select * into v_product from public.products
      where id = (v_item->>'product_id')::uuid and active = true
      for update;
    if not found then raise exception 'Product not found or inactive'; end if;
    if v_product.stock_qty < v_qty then
      raise exception 'Insufficient stock for %', v_product.name;
    end if;
    v_price := v_product.selling_price;
    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;
  if coalesce(p_discount_amount,0) < 0 or coalesce(p_tax_amount,0) < 0 then
    raise exception 'Discount and tax cannot be negative';
  end if;
  if coalesce(p_discount_amount,0) > v_subtotal then
    raise exception 'Discount cannot exceed subtotal';
  end if;
  v_total := greatest(0, v_subtotal - coalesce(p_discount_amount,0) + coalesce(p_tax_amount,0));
  v_invoice := 'MRS-' || to_char(now(),'YYYYMMDD-HH24MISS') || '-' || upper(substr(gen_random_uuid()::text,1,6));
  insert into public.sales(invoice_number,subtotal,tax_amount,discount_amount,total_amount,payment_method,created_by)
  values(v_invoice,v_subtotal,coalesce(p_tax_amount,0),coalesce(p_discount_amount,0),v_total,p_payment_method,auth.uid())
  returning id into v_sale_id;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid for update;
    v_price := v_product.selling_price;
    v_line := v_price * v_qty;
    insert into public.sale_items(sale_id,product_id,product_name,sku,quantity,unit_price,line_total)
    values(v_sale_id,v_product.id,v_product.name,v_product.sku,v_qty,v_price,v_line);
    update public.products set stock_qty=stock_qty-v_qty, updated_at=now() where id=v_product.id;
  end loop;
  return jsonb_build_object('sale_id',v_sale_id,'invoice_number',v_invoice,'subtotal',v_subtotal,'total_amount',v_total);
end;
$$;

revoke all on function public.complete_sale(jsonb,text,numeric,numeric) from public;
grant execute on function public.complete_sale(jsonb,text,numeric,numeric) to authenticated;
