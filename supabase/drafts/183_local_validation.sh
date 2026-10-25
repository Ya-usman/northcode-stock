#!/bin/bash
# Validation LOCALE de 183 (C3 : dettes fournisseurs réservées au serveur) — base PostgreSQL jetable UNIQUEMENT, jamais
# la production. Applique le fichier EXACT du dépôt avec la CLI Supabase (db push), comme en production.
# Usage (racine du dépôt) : bash supabase/drafts/183_local_validation.sh
set -u
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
REPO="$(pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
URL() { echo "postgresql://postgres@$HOST:$PORT/$1?sslmode=disable"; }
CLI() { npx --yes supabase@2.122.0 "$@" < /dev/null 2>&1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

mkdir -p "$WORK/main/supabase/migrations"; cp "$REPO"/supabase/migrations/*.sql "$WORK/main/supabase/migrations/"
ok "$(sha256sum "$WORK/main/supabase/migrations/183_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/183_"*.sql | cut -c1-64)" "copie exacte de la 183"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 183 | tr '\n' ' ')"

schema() {
P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
P -d "$1" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
ALTER ROLE service_role BYPASSRLS; -- comme sur Supabase (le rôle peut exister d'un banc précédent, sans l'attribut)
CREATE FUNCTION public.is_shop_member(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT true';
CREATE TABLE public.suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, name text NOT NULL, phone text, city text,
  created_at timestamptz DEFAULT now(), deleted_at timestamptz, email text, total_owed numeric NOT NULL DEFAULT 0);
CREATE TABLE public.purchase_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, supplier_id uuid REFERENCES public.suppliers(id), reference text,
  status text, total_amount numeric DEFAULT 0, amount_paid numeric DEFAULT 0, payment_status text DEFAULT 'unpaid', balance numeric GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  is_opening_balance boolean DEFAULT false);
CREATE TABLE public.supplier_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id uuid REFERENCES public.purchase_orders(id), amount numeric NOT NULL, method text, paid_at timestamptz DEFAULT now());
CREATE TABLE public.purchase_order_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_order_id uuid REFERENCES public.purchase_orders(id), product_name text, unit_price numeric);
CREATE TABLE public.product_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, supplier_id uuid REFERENCES public.suppliers(id), quantity int);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY; ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY; ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY suppliers_member_select ON public.suppliers FOR SELECT USING (is_shop_member(shop_id) AND deleted_at IS NULL);
CREATE POLICY suppliers_shop_select ON public.suppliers FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY purchase_orders_select ON public.purchase_orders FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY supplier_payments_select ON public.supplier_payments FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = supplier_payments.purchase_order_id AND is_shop_member(po.shop_id)));
CREATE POLICY purchase_order_items_select ON public.purchase_order_items FOR SELECT USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_items.purchase_order_id AND is_shop_member(po.shop_id)));
CREATE POLICY product_batches_select ON public.product_batches FOR SELECT USING (is_shop_member(shop_id));
-- Déclencheur des paiements (comme 093) : SECURITY DEFINER, met à jour la dette
CREATE FUNCTION public.update_supplier_debt_on_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $f$
BEGIN
  UPDATE suppliers s SET total_owed = GREATEST(0, s.total_owed - new.amount) FROM purchase_orders po WHERE po.id = new.purchase_order_id AND po.supplier_id = s.id;
  UPDATE purchase_orders SET amount_paid = amount_paid + new.amount WHERE id = new.purchase_order_id;
  RETURN new;
END $f$;
CREATE TRIGGER after_supplier_payment_insert AFTER INSERT ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.update_supplier_debt_on_payment();
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
REVOKE SELECT ON public.purchase_order_items FROM anon, authenticated; -- comme la 173
INSERT INTO public.suppliers (id, shop_id, name, total_owed) VALUES ('00000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-000000000001', 'Fourn', 9000);
INSERT INTO public.purchase_orders (id, shop_id, supplier_id, reference, status, total_amount) VALUES ('00000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 'BC-1', 'received', 9000);
INSERT INTO public.supplier_payments (purchase_order_id, amount, method) VALUES ('00000000-0000-0000-0000-0000000000e1', 1000, 'cash');
INSERT INTO public.product_batches (shop_id, supplier_id, quantity) VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1', 5);
SQL
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL "$1")" --workdir "$WORK/main" > "$WORK/repair-$1.log" || { echo "repair local impossible"; cat "$WORK/repair-$1.log"; exit 2; }
}
ACL() { P -d "$1" -c "select string_agg(x, ' | ' order by x) from (select c.relname || ':' || coalesce(array_to_string(c.relacl, ','), '') as x from pg_class c where c.relname in ('suppliers','purchase_orders','supplier_payments','purchase_order_items') and c.relnamespace = 'public'::regnamespace union all select c.relname || '.' || a.attname || ':' || array_to_string(a.attacl, ',') from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname in ('suppliers','purchase_orders','supplier_payments') and c.relnamespace = 'public'::regnamespace and a.attacl is not null) t"; }
HIST() { P -d "$1" -c "select coalesce(string_agg(version || ':' || name, ' ' order by version), '') from supabase_migrations.schema_migrations where version >= '183'"; }
R() { P -d c3val -c "set role $1; $2" 2>&1 | tail -1; }

echo "── 1. Base jetable « c3val », historique 001 → 182 enregistré"
schema c3val
ok "$(P -d c3val -c "select count(*) from supabase_migrations.schema_migrations")" "$(echo $OLD_VERSIONS | wc -w)" "historique local : $(echo $OLD_VERSIONS | wc -w) versions (comme la production)"
DRY="$(CLI db push --dry-run --db-url "$(URL c3val)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "183_c3_supplier_debts_server_only.sql" "db push --dry-run : exactement la 183"
ACL0="$(ACL c3val)"

echo "── 2. db push"
PUSH="$(CLI db push --yes --db-url "$(URL c3val)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|WARNING|ERROR" | sed 's/^/      /'
ok "$(HIST c3val)" "183:c3_supplier_debts_server_only" "historique : 183 enregistrée"
ok "$(echo "$PUSH" | grep -c "SET LOCAL can only be used")" "0" "SET LOCAL lock_timeout dans la transaction de la CLI"

echo "── 3. Droits effectifs"
ok "$(R authenticated "select name || '/' || coalesce(phone, '-') from public.suppliers")" "Fourn/-" "authenticated : fiche fournisseur lisible (colonnes publiques)"
ok "$(R authenticated "select total_owed from public.suppliers" | grep -c 'permission denied')" "1" "authenticated : total_owed refusé"
ok "$(R authenticated "select * from public.suppliers" | grep -c 'permission denied')" "1" "authenticated : « * » refusé sur suppliers"
ok "$(R authenticated "select s.name from public.product_batches b join public.suppliers s on s.id = b.supplier_id")" "Fourn" "authenticated : suppliers(name) imbriqué depuis les lots intact"
ok "$(R authenticated "select count(*) from public.suppliers where deleted_at is null")" "1" "authenticated : règles RLS de suppliers (deleted_at) intactes"
ok "$(R authenticated "select id from public.purchase_orders" | grep -c 'permission denied')" "1" "authenticated : purchase_orders refusée"
ok "$(R authenticated "select count(*) from public.purchase_orders" | grep -c 'permission denied')" "1" "authenticated : comptage de purchase_orders refusé"
ok "$(R authenticated "select amount from public.supplier_payments" | grep -c 'permission denied')" "1" "authenticated : supplier_payments refusée"
ok "$(R authenticated "select id from public.purchase_order_items" | grep -c 'permission denied')" "1" "authenticated : purchase_order_items toujours refusée (173)"
ok "$(R anon "select name from public.suppliers" | grep -c 'permission denied')" "1" "anon : aucune lecture de suppliers"
ok "$(R service_role "select total_owed || '/' || (select balance from public.purchase_orders) || '/' || (select sum(amount) from public.supplier_payments) from public.suppliers")" "8000/8000/1000" "service_role : dette, solde, paiements lisibles (serveur)"
P -d c3val -c "set role service_role; insert into public.supplier_payments (purchase_order_id, amount, method) values ('00000000-0000-0000-0000-0000000000e1', 500, 'cash')" >/dev/null
ok "$(R service_role "select total_owed || '/' || (select amount_paid from public.purchase_orders) from public.suppliers")" "7500/1500" "déclencheur des paiements (SECURITY DEFINER) : dette et payé mis à jour"
ok "$(P -d c3val -c "select has_table_privilege('authenticated','public.suppliers','SELECT')::text || '/' || has_any_column_privilege('authenticated','public.purchase_orders','SELECT')::text || '/' || has_any_column_privilege('authenticated','public.supplier_payments','SELECT')::text")" "false/false/false" "aucun SELECT de table ni de colonne restant sur les dettes"
P -d c3val -c "alter table public.suppliers add column zz_future text" >/dev/null
ok "$(P -d c3val -c "select has_column_privilege('authenticated','public.suppliers','zz_future','SELECT')::text")" "false" "fail-closed : une colonne ajoutée plus tard est illisible sans son GRANT"
P -d c3val -c "alter table public.suppliers drop column zz_future" >/dev/null

echo "── 4. Retour arrière exact"
P -d c3val -f "$REPO/supabase/rollbacks/183_c3_supplier_debts_server_only_rollback.sql" >/dev/null
ok "$(ACL c3val)" "$ACL0" "rollback 183 : droits IDENTIQUES à avant"

echo "── 5. Échec : droit hérité de PUBLIC"
schema c3fail
P -d c3fail -c "grant select (total_owed) on public.suppliers to public" >/dev/null
ACLb="$(ACL c3fail)"
OUT="$(CLI db push --yes --db-url "$(URL c3fail)" --workdir "$WORK/main")"
ok "$(echo "$OUT" | grep -c "183 : droits de colonne inattendus sur suppliers")" "1" "total_owed hérité de PUBLIC : le garde-fou l'attrape"
ok "$(HIST c3fail)|$(ACL c3fail)" "|$ACLb" "→ 183 annulée entière (absente de l'historique, droits inchangés)"

for d in c3val c3fail; do P -d postgres -c "drop database if exists $d" >/dev/null; done
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
