-- Fix set_sale_number: use MAX of numeric suffix instead of COUNT(*)
-- COUNT causes duplicate key errors when sales have been deleted (count reuses a number)
-- MAX always gives the next unused number even after deletions

create or replace function set_sale_number()
returns trigger as $$
declare
  shop_prefix text;
  next_num int;
begin
  select upper(substring(name, 1, 3)) into shop_prefix
  from shops where id = new.shop_id;

  -- Use MAX of the numeric part of existing sale_numbers to avoid collisions
  -- after sales have been deleted or in case of concurrent inserts
  select coalesce(
    max(
      case when sale_number ~ ('^' || upper(substring(name, 1, 3)) || '-[0-9]+$')
        then (regexp_match(sale_number, '[0-9]+$'))[1]::int
      end
    ),
    0
  ) + 1 into next_num
  from sales
  join shops on shops.id = sales.shop_id
  where sales.shop_id = new.shop_id;

  new.sale_number := shop_prefix || '-' || lpad(next_num::text, 4, '0');
  return new;
end;
$$ language plpgsql security definer;
