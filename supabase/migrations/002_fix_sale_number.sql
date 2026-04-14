-- Fix set_sale_number: use MAX of numeric suffix instead of COUNT(*)
-- COUNT causes duplicate key errors when sales have been deleted (count reuses a number already taken)

create or replace function set_sale_number()
returns trigger as $$
declare
  shop_prefix text;
  next_num int;
begin
  select upper(substring(name, 1, 3)) into shop_prefix
  from shops where id = new.shop_id;

  -- MAX of existing numeric suffixes + 1, so deletions never cause collisions
  select coalesce(
    max(
      nullif(regexp_replace(sale_number, '^[A-Z]+-', ''), '')::int
    ), 0
  ) + 1 into next_num
  from sales
  where shop_id = new.shop_id;

  new.sale_number := shop_prefix || '-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer;
