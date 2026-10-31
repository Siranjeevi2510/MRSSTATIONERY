-- Public, read-only catalogue data. Exposes only fields safe for customers.
create or replace function public.public_catalogue_products()
returns table (
  product_id uuid,
  sku text,
  name text,
  category text,
  selling_price numeric,
  in_stock boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.sku, p.name, p.category, p.selling_price, (p.stock_qty > 0)
  from public.products p
  where p.active = true
  order by p.name;
$$;

revoke all on function public.public_catalogue_products() from public;
grant execute on function public.public_catalogue_products() to anon, authenticated;
