#!/bin/bash
# Validation LOCALE de 198 (numéros de série, lot B : la vente) — base PostgreSQL jetable UNIQUEMENT.
# complete_sale de PRODUCTION (drafts/198_prod) installée d'abord : une vente SANS produit suivi doit donner exactement
# le même résultat avant et après la 198. Déclencheur de stock simulé (la 198 ne le touche pas).
# Usage (racine du dépôt) : bash supabase/drafts/198_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r198
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(serial_[a-z_]+|permission denied)' | head -1; }
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
  product_name text, quantity int, unit_price numeric, buying_price numeric, original_price numeric, stock_shortfall int not null default 0);
CREATE TABLE payments (id uuid primary key default gen_random_uuid(), sale_id uuid, amount numeric, method text, reference text, received_by uuid, paid_at timestamptz);
CREATE TABLE stock_transfers (id uuid primary key);
CREATE TABLE product_batches (id uuid primary key default gen_random_uuid());
CREATE FUNCTION gen_receipt_token() RETURNS text LANGUAGE sql AS $$ SELECT md5(random()::text) $$;
-- Déclencheur de stock simulé (production : deduct_stock_on_sale, non modifié par la 198)
CREATE FUNCTION sim_deduct() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF coalesce(current_setting('stockshop.stock_mode', true), '') = 'skip' THEN RETURN NEW; END IF;
  UPDATE products SET quantity = quantity - NEW.quantity WHERE id = NEW.product_id; RETURN NEW; END $$;
CREATE TRIGGER after_sale_item_insert AFTER INSERT ON sale_items FOR EACH ROW EXECUTE FUNCTION sim_deduct();
-- Registre de la 197 (schéma utile)
CREATE TABLE product_serials (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, serial text, status text,
  sale_item_id uuid references sale_items(id) on delete set null, sold_at timestamptz, updated_at timestamptz);
CREATE UNIQUE INDEX ON product_serials(shop_id, upper(serial));
SQL
P -d $DB -f supabase/drafts/198_prod/prod-complete_sale.sql >/dev/null || { echo "définition de production impossible"; exit 2; }

S1=11111111-1111-1111-1111-111111111111; U=99999999-0000-0000-0000-000000000001
PR=aaaaaaaa-0000-0000-0000-000000000001; PT=aaaaaaaa-0000-0000-0000-000000000002
P -d $DB -c "insert into products values ('$PR','$S1','Riz',10,50,null,false),('$PT','$S1','Telephone',5,100,null,true);
  insert into product_serials (shop_id, product_id, serial, status) values ('$S1','$PT','S1','in_stock'),('$S1','$PT','S2','in_stock'),('$S1','$PT','S3','in_stock'),('$S1','$PT','S4','in_stock'),('$S1','$PT','S5','in_stock')" >/dev/null
sale() { # $1 client id, $2 items json, $3 created_at (vide = en ligne)
  local at="null"; [ -n "${3:-}" ] && at="'$3'"
  echo "select complete_sale('$S1','$U',null,null,null,100,0,0,100,'cash',null,null,'$1','$2'::jsonb,'[{\"amount\":100,\"method\":\"cash\"}]'::jsonb,null,$at,null,null)"
}
SNAP() { Q "select string_agg(concat_ws(':', si.product_name, si.quantity, si.unit_price, si.stock_shortfall), ',' order by si.product_name) || '|' || max(s.total) || '|' || coalesce(max(s.review_reason),'-') || '|' || (select quantity from products where id='$PR') || '|' || (select count(*) from payments p where p.sale_id = s.id) from sales s join sale_items si on si.sale_id = s.id where s.client_request_id = '$1' group by s.id"; }

# Référence AVANT la 198 : vente non suivie, en ligne
P -d $DB -c "$(sale R-1 "[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":2,\"unit_price\":50}]")" >/dev/null
REF=$(SNAP R-1); P -d $DB -c "update products set quantity=10 where id='$PR'" >/dev/null

# 197 supposée appliquée : on ne charge que la 198
for i in 1 2; do P -d $DB -1 -f supabase/migrations/198_sale_serials.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/198_sale_serials.sql; exit 1; }; done
P -d $DB -c "$(sale R-2 "[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":2,\"unit_price\":50}]")" >/dev/null
ok "$(SNAP R-2)" "$REF" "vente non suivie : résultat identique à la production ($REF)"

# En ligne, produit suivi
ok "$(ERR "$(sale T-1 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":2,\"unit_price\":100,\"serials\":[\"S1\"]}]")")" "serial_count_mismatch" "en ligne : 1 numéro pour 2 unités refusé"
ok "$(Q "select count(*) from sales where client_request_id='T-1'")|$(Q "select quantity from products where id='$PT'")" "0|5" "refus : aucune vente, stock inchangé"
ok "$(ERR "$(sale T-2 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":2,\"unit_price\":100,\"serials\":[\"S1\",\"s1\"]}]")")" "serial_duplicate_input" "en ligne : même numéro deux fois refusé"
ok "$(ERR "$(sale T-3 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"INCONNU\"]}]")")" "serial_not_in_stock" "en ligne : numéro inconnu refusé"
ok "$(ERR "$(sale T-4 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100}]")")" "serial_count_mismatch" "en ligne : produit suivi sans numéro refusé"
P -d $DB -c "$(sale T-5 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"s2\"]},{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"S3\"]},{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":1,\"unit_price\":50}]")" >/dev/null
ok "$(Q "select count(*) from product_serials ps join sale_items si on si.id=ps.sale_item_id join sales s on s.id=si.sale_id where s.client_request_id='T-5' and ps.status='sold' and ps.sold_at is not null")" "2" "vente valide : S2 et S3 vendus, rattachés aux lignes (deux lignes du même produit)"
ok "$(Q "select count(distinct ps.sale_item_id) from product_serials ps join sale_items si on si.id=ps.sale_item_id join sales s on s.id=si.sale_id where s.client_request_id='T-5'")" "2" "un numéro par ligne"
ok "$(Q "select coalesce(review_reason,'-') from sales where client_request_id='T-5'")" "-" "vente valide : pas « à vérifier »"
ok "$(ERR "$(sale T-6 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"S2\"]}]")")" "serial_not_in_stock" "numéro déjà vendu refusé"
# Renvoi de la même vente (réponse perdue) : rien de nouveau
P -d $DB -c "$(sale T-5 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"S4\"]}]")" >/dev/null
ok "$(Q "select status from product_serials where serial='S4'")|$(Q "select count(*) from sales where client_request_id='T-5'")" "in_stock|1" "renvoi de la même vente : aucun numéro de plus, une seule vente"

# Hors ligne : jamais de refus
P -d $DB -c "$(sale O-1 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":2,\"unit_price\":100,\"serials\":[\"S4\",\"INCONNU\"]}]" "2026-11-01 10:00+01")" >/dev/null
ok "$(Q "select review_reason from sales where client_request_id='O-1'")|$(Q "select status from product_serials where serial='S4'")" "serial_unresolved|sold" "hors ligne : vente gardée « à vérifier », numéro valide vendu"
P -d $DB -c "$(sale O-2 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100}]" "2026-11-01 10:05+01")" >/dev/null
ok "$(Q "select review_reason from sales where client_request_id='O-2'")" "serial_unresolved" "hors ligne sans numéro : vente gardée « à vérifier »"

# Annulation, suppression, modification
P -d $DB -c "update sales set sale_status='cancelled' where client_request_id='T-5'" >/dev/null
ok "$(Q "select string_agg(status, ',' order by serial) from product_serials where serial in ('S2','S3')")|$(Q "select count(*) from product_serials where serial in ('S2','S3') and sale_item_id is null")" "in_stock,in_stock|2" "vente annulée : S2 et S3 remis en stock"
P -d $DB -c "delete from sale_items where sale_id=(select id from sales where client_request_id='O-1')" >/dev/null
ok "$(Q "select status from product_serials where serial='S4'")" "in_stock" "ligne supprimée : S4 remis en stock"
P -d $DB -c "$(sale T-7 "[{\"product_id\":\"$PT\",\"product_name\":\"Telephone\",\"quantity\":1,\"unit_price\":100,\"serials\":[\"S5\"]}]")" >/dev/null
P -d $DB -c "begin; select set_config('stockshop.stock_mode','skip',true); delete from sale_items where sale_id=(select id from sales where client_request_id='T-7'); commit;" >/dev/null
ok "$(Q "select status from product_serials where serial='S5'")" "sold" "mode modification (skip) : S5 reste vendu"
ok "$(ERR "set role authenticated; select assign_sale_serials(null,null,'[]'::jsonb,false,now())")" "permission denied" "assign_sale_serials non exécutable par les connectés"

# Retour arrière : production restaurée, puis ré-application
P -d $DB -1 -f supabase/rollbacks/198_sale_serials_rollback.sql >/dev/null 2>&1 || { echo "retour arrière ÉCHEC"; P -d $DB -1 -f supabase/rollbacks/198_sale_serials_rollback.sql; }
ok "$(Q "select position('assign_sale_serials' in pg_get_functiondef('complete_sale(uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,text,text,text,text,jsonb,jsonb,date,timestamptz,text,text)'::regprocedure))")|$(Q "select count(*) from pg_trigger where tgname like 'trg_release_serials%'")" "0|0" "retour arrière : complete_sale de production, déclencheurs retirés"
P -d $DB -c "update products set quantity=10 where id='$PR'" >/dev/null
P -d $DB -c "$(sale R-3 "[{\"product_id\":\"$PR\",\"product_name\":\"Riz\",\"quantity\":2,\"unit_price\":50}]")" >/dev/null
ok "$(SNAP R-3)" "$REF" "après retour arrière : vente non suivie identique"
P -d $DB -1 -f supabase/migrations/198_sale_serials.sql >/dev/null 2>&1 && echo "ré-application ok" || echo "ré-application ÉCHEC"

echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
exit $fail
