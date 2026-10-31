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
