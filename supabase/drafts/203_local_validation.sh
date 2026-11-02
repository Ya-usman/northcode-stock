#!/bin/bash
# Validation LOCALE de 203 (mesures de vente) — base PostgreSQL jetable UNIQUEMENT. complete_sale de PRODUCTION
# (drafts/203_prod, 198 comprise) installée d'abord : une vente SANS mesure doit donner exactement le même résultat
# avant et après la 203, puis après le retour arrière. Schéma repris du banc de la 198 (déclencheur de stock simulé).
# Usage (racine du dépôt) : bash supabase/drafts/203_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r203
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(products_sale_measures_check|sale_items_measure_check|permission denied)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE TABLE shops (id uuid primary key);
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, quantity int not null default 0, buying_price numeric not null default 0,
  updated_at timestamptz, track_serials boolean not null default false);
CREATE TABLE customers (id uuid primary key default gen_random_uuid(), shop_id uuid, name text, phone text);
CREATE TABLE sales (id uuid primary key default gen_random_uuid(), shop_id uuid, customer_id uuid, cashier_id uuid, subtotal numeric, discount numeric,
  tax numeric, total numeric, payment_method text, payment_status text, amount_paid numeric, sale_status text, notes text, paystack_reference text,
  client_request_id text unique, due_date date, created_at timestamptz, receipt_token text, review_reason text);
CREATE TABLE sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid references sales(id) on delete cascade, product_id uuid,
  product_name text, quantity int, unit_price numeric, buying_price numeric, original_price numeric, stock_shortfall int not null default 0,
  subtotal numeric GENERATED ALWAYS AS ((quantity)::numeric * unit_price) STORED);
CREATE TABLE payments (id uuid primary key default gen_random_uuid(), sale_id uuid, amount numeric, method text, reference text, received_by uuid, paid_at timestamptz);
CREATE TABLE stock_transfers (id uuid primary key);
CREATE TABLE product_batches (id uuid primary key default gen_random_uuid());
CREATE FUNCTION gen_receipt_token() RETURNS text LANGUAGE sql AS $$ SELECT md5(random()::text) $$;
CREATE FUNCTION sim_deduct() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF coalesce(current_setting('stockshop.stock_mode', true), '') = 'skip' THEN RETURN NEW; END IF;
  UPDATE products SET quantity = quantity - NEW.quantity WHERE id = NEW.product_id; RETURN NEW; END $$;
CREATE TRIGGER after_sale_item_insert AFTER INSERT ON sale_items FOR EACH ROW EXECUTE FUNCTION sim_deduct();
CREATE TABLE product_serials (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, serial text, status text,
  sale_item_id uuid references sale_items(id) on delete set null, sold_at timestamptz, updated_at timestamptz);
CREATE UNIQUE INDEX ON product_serials(shop_id, upper(serial));
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT (id, name, quantity) ON products TO authenticated;
SQL
# État de production : 198 (assign_sale_serials) puis complete_sale exacte de la production
P -d $DB -1 -f supabase/migrations/198_sale_serials.sql >/dev/null 2>&1 || { echo "198 impossible"; exit 2; }
P -d $DB -f supabase/drafts/203_prod/prod-complete_sale.sql >/dev/null || { echo "définition de production impossible"; exit 2; }

S1=11111111-1111-1111-1111-111111111111; U=99999999-0000-0000-0000-000000000001
PR=aaaaaaaa-0000-0000-0000-000000000001
P -d $DB -c "insert into products values ('$PR','$S1','Riz',100,50,null,false)" >/dev/null
sale() { # $1 client id, $2 items json, $3 total
  echo "select complete_sale('$S1','$U',null,null,null,${3:-100},0,0,${3:-100},'cash',null,null,'$1','$2'::jsonb,'[{\"amount\":${3:-100},\"method\":\"cash\"}]'::jsonb,null,null,null,null)"
}
SNAP() { Q "select string_agg(concat_ws(':', si.product_name, si.quantity, si.unit_price, si.subtotal, si.stock_shortfall), ',' order by si.product_name) || '|' || max(s.total) || '|' || coalesce(max(s.review_reason),'-') || '|' || (select quantity from products where id='$PR') from sales s join sale_items si on si.sale_id = s.id where s.client_request_id = '$1' group by s.id"; }
ITEMS="[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":2,\"unit_price\":200}]"

echo "1. Référence de production (vente sans mesure)"
P -d $DB -c "$(sale R-1 "$ITEMS" 400)" >/dev/null
REF=$(SNAP R-1); P -d $DB -c "update products set quantity=100 where id='$PR'" >/dev/null
echo "   $REF"

echo "2. Application (deux fois)"
for i in 1 2; do ok "$(P -d $DB -1 -f supabase/migrations/203_sale_measures.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "passage $i sans erreur"; done
P -d $DB -c "$(sale R-2 "$ITEMS" 400)" >/dev/null
ok "$(SNAP R-2)" "$REF" "vente sans mesure : résultat identique à la production"
ok "$(Q "select coalesce(measure_key,'-') || coalesce(measure_qty::text,'-') from sale_items si join sales s on s.id=si.sale_id where s.client_request_id='R-2'")" "--" "vente sans mesure : colonnes de mesure vides"
P -d $DB -c "update products set quantity=100 where id='$PR'" >/dev/null

echo "3. Vente en mesures"
# 3 boîtes de 3 verres à 550 F la boîte = 9 verres à 183,333… = 1 650 F
BOX="[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":9,\"unit_price\":183.333333,\"measure_key\":\"box\",\"measure_qty\":3,\"measure_units\":3}]"
P -d $DB -c "$(sale M-1 "$BOX" 1650)" >/dev/null
ok "$(Q "select concat(si.measure_key, ':', si.measure_qty, 'x', si.measure_units, ':', si.quantity, ':', round(si.subtotal)) from sale_items si join sales s on s.id=si.sale_id where s.client_request_id='M-1'")" "box:3x3:9:1650" "3 boîtes = 9 verres, 1 650 F, mesure gardée"
ok "$(Q "select quantity from products where id='$PR'")" "91" "stock : 100 → 91 verres"
SEAU="[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":40,\"unit_price\":150,\"measure_key\":\"custom\",\"measure_label\":\"  Koro  \",\"measure_qty\":2,\"measure_units\":20}]"
P -d $DB -c "$(sale M-2 "$SEAU" 6000)" >/dev/null
ok "$(Q "select measure_key || ':' || measure_label from sale_items si join sales s on s.id=si.sale_id where s.client_request_id='M-2'")" "custom:Koro" "mesure libre « Koro » gardée (espaces retirés)"
BAD="[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":8,\"unit_price\":200,\"measure_key\":\"box\",\"measure_qty\":3,\"measure_units\":3}]"
ok "$(ERR "$(sale M-3 "$BAD" 1600)")" "sale_items_measure_check" "quantité ≠ nombre × contenu : refusée"
ok "$(Q "select count(*) from sales where client_request_id='M-3'")|$(Q "select quantity from products where id='$PR'")" "0|51" "refus : aucune vente, stock inchangé (51)"
HALF="[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":3,\"unit_price\":200,\"measure_key\":\"box\"}]"
ok "$(ERR "$(sale M-4 "$HALF" 600)")" "sale_items_measure_check" "mesure incomplète (sans nombre ni contenu) : refusée"

echo "4. Mesures d'un produit"
ok "$(Q "update products set sale_measures='[{\"key\":\"box\",\"units\":3,\"price\":550},{\"key\":\"kg\",\"units\":4,\"price\":700},{\"key\":\"bucket\",\"units\":40,\"price\":6500},{\"key\":\"bag\",\"units\":200,\"price\":30000},{\"key\":\"custom\",\"label\":\"Koro\",\"units\":20,\"price\":3300}]' where id='$PR' returning name")" "Riz" "5 mesures (boîte, kilo, seau, sac, Koro)"
ok "$(ERR "update products set sale_measures='[{\"key\":\"box\",\"units\":3,\"price\":550},{\"key\":\"kg\",\"units\":4,\"price\":700},{\"key\":\"bucket\",\"units\":40,\"price\":6500},{\"key\":\"bag\",\"units\":200,\"price\":30000},{\"key\":\"cup\",\"units\":2,\"price\":380},{\"key\":\"bowl\",\"units\":5,\"price\":900}]' where id='$PR'")" "products_sale_measures_check" "6 mesures refusées"
ok "$(ERR "update products set sale_measures='[{\"key\":\"tonneau\",\"units\":3,\"price\":550}]' where id='$PR'")" "products_sale_measures_check" "mesure hors liste refusée"
ok "$(ERR "update products set sale_measures='[{\"key\":\"custom\",\"units\":3,\"price\":550}]' where id='$PR'")" "products_sale_measures_check" "mesure libre sans nom refusée"
ok "$(ERR "update products set sale_measures='[{\"key\":\"box\",\"units\":1,\"price\":550}]' where id='$PR'")" "products_sale_measures_check" "contenu 1 refusé (au moins 2)"
ok "$(ERR "update products set sale_measures='[{\"key\":\"box\",\"units\":3,\"price\":0}]' where id='$PR'")" "products_sale_measures_check" "prix 0 refusé"
ok "$(ERR "update products set sale_measures='[{\"key\":\"box\",\"units\":3,\"price\":550},{\"key\":\"box\",\"units\":4,\"price\":700}]' where id='$PR'")" "products_sale_measures_check" "même mesure deux fois refusée"
ok "$(ERR "update products set sale_measures='[{\"key\":\"custom\",\"label\":\"Koro\",\"units\":3,\"price\":550},{\"key\":\"custom\",\"label\":\"koro \",\"units\":4,\"price\":700}]' where id='$PR'")" "products_sale_measures_check" "même mesure libre deux fois (casse, espaces) refusée"
ok "$(P -d $DB -c "set role authenticated; select count(sale_measures) >= 0 from products" 2>&1 | tail -1)" "t" "mesures lisibles par authenticated"

echo "5. Retour arrière puis réapplication"
ok "$(P -d $DB -1 -f supabase/rollbacks/203_sale_measures_rollback.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "retour arrière sans erreur"
P -d $DB -c "update products set quantity=100 where id='$PR'" >/dev/null
P -d $DB -c "$(sale R-3 "$ITEMS" 400)" >/dev/null
ok "$(SNAP R-3)" "$REF" "après retour arrière : vente identique à la production"
ok "$(Q "select count(*) from information_schema.columns where table_name='sale_items' and column_name like 'measure%'")" "0" "colonnes de mesure retirées"
ok "$(P -d $DB -1 -f supabase/migrations/203_sale_measures.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "réapplication sans erreur"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
