-- Product images for POS uploads and public catalogue display.
alter table public.products
  add column if not exists image_url text;

-- Publicly readable images; only owners and managers may upload, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Public can view product images" on storage.objects;
create policy "Public can view product images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Managers can upload product images" on storage.objects;
create policy "Managers can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.current_user_role() in ('owner', 'manager')
);

drop policy if exists "Managers can update product images" on storage.objects;
create policy "Managers can update product images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_role() in ('owner', 'manager')
)
with check (
  bucket_id = 'product-images'
  and public.current_user_role() in ('owner', 'manager')
);

drop policy if exists "Managers can delete product images" on storage.objects;
create policy "Managers can delete product images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.current_user_role() in ('owner', 'manager')
);

-- Replace the public catalogue RPC with the image URL added.
drop function if exists public.public_catalogue_products();
create function public.public_catalogue_products()
returns table (
  product_id uuid,
  sku text,
  name text,
  category text,
  selling_price numeric,
  in_stock boolean,
  image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.sku, p.name, p.category, p.selling_price,
         (p.stock_qty > 0), p.image_url
  from public.products p
  where p.active = true
  order by p.name;
$$;

revoke all on function public.public_catalogue_products() from public;
grant execute on function public.public_catalogue_products() to anon, authenticated;
