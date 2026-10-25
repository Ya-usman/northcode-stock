#!/bin/bash
# Validation LOCALE de 181 (view_purchase_cost) et 182 (C2 : buying_price réservé au serveur) — base PostgreSQL
# jetable UNIQUEMENT, jamais la production. Applique les fichiers EXACTS du dépôt avec la CLI Supabase (db push),
# comme en production, sur une copie du dossier des migrations.
# Usage (racine du dépôt) : SEED=<jeu d'essai .sql> bash supabase/drafts/181_182_local_validation.sh
#   SEED : produit par supabase/drafts/181_182_seed_from_prod.js (réglages de rôles + couples boutique / rôle).
set -u
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
REPO="$(pwd)"; SEED="${SEED:?SEED obligatoire}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
URL() { echo "postgresql://postgres@$HOST:$PORT/$1?sslmode=disable"; }
CLI() { npx --yes supabase@2.122.0 "$@" < /dev/null 2>&1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

# Copie des migrations (fichiers EXACTS) : 001 → 182
mkdir -p "$WORK/main/supabase/migrations"; cp "$REPO"/supabase/migrations/*.sql "$WORK/main/supabase/migrations/"
for v in 181 182; do ok "$(sha256sum "$WORK/main/supabase/migrations/${v}_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/${v}_"*.sql | cut -c1-64)" "copie exacte de la $v"; done
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx -e 181 -e 182 | tr '\n' ' ')"

schema() { # $1 = base
P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
P -d "$1" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE TABLE public.shops (id uuid PRIMARY KEY, deleted_at timestamptz, role_permissions jsonb);
CREATE TABLE public.shop_members (id serial PRIMARY KEY, shop_id uuid, user_id uuid DEFAULT gen_random_uuid(), role text, is_active boolean);
CREATE TABLE public.sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid);
CREATE TABLE public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, name text NOT NULL, name_hausa text, sku text, category_id uuid, supplier_id uuid,
  buying_price numeric NOT NULL DEFAULT 0, selling_price numeric NOT NULL DEFAULT 0, quantity integer NOT NULL DEFAULT 0, unit text,
  low_stock_threshold integer, image_url text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  promo_price numeric, promo_until timestamptz, promo_reason text, promo_start timestamptz, is_favorite boolean NOT NULL DEFAULT false);
CREATE TABLE public.product_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, product_id uuid, supplier_id uuid, quantity integer NOT NULL, initial_quantity integer NOT NULL,
  buying_price numeric, expiry_date date, source text NOT NULL DEFAULT 'restock', received_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(), promo_price numeric, promo_until timestamptz, promo_start timestamptz, origin_inventory_session_id uuid);
CREATE TABLE public.sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid, product_id uuid, product_name text NOT NULL, quantity integer NOT NULL, unit_price numeric NOT NULL,
  subtotal numeric GENERATED ALWAYS AS (quantity * unit_price) STORED, buying_price numeric(12,2) NOT NULL DEFAULT 0, original_price numeric,
  stock_shortfall integer NOT NULL DEFAULT 0, batch_unallocated integer NOT NULL DEFAULT 0);
CREATE TABLE public.sale_item_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_item_id uuid, quantity integer);
CREATE FUNCTION public.is_shop_member(uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS 'SELECT true';
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY; ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sale_item_batches ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_member_select ON public.products FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY product_batches_select ON public.product_batches FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY sales_select ON public.sales FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY sale_items_member_select ON public.sale_items FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_shop_member(s.shop_id)));
CREATE POLICY sale_item_batches_select ON public.sale_item_batches FOR SELECT USING (EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)));
CREATE VIEW public.shop_stats_test WITH (security_invoker = true) AS
  SELECT p.shop_id, count(DISTINCT p.id) FILTER (WHERE p.is_active) AS product_count, coalesce(sum(p.quantity * p.selling_price), 0) AS stock_value FROM public.products p GROUP BY p.shop_id;
-- Droits comme sur Supabase : tout pour anon / authenticated / service_role, la RLS filtre
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
INSERT INTO public.sales (id, shop_id) VALUES ('00000000-0000-0000-0000-00000000aa01', 'a0000000-0000-0000-0000-000000000001');
INSERT INTO public.products (id, shop_id, name, buying_price, selling_price, quantity) VALUES ('00000000-0000-0000-0000-00000000bb01', 'a0000000-0000-0000-0000-000000000001', 'Riz', 400, 500, 10);
INSERT INTO public.product_batches (shop_id, product_id, quantity, initial_quantity, buying_price) VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000bb01', 10, 10, 400);
INSERT INTO public.sale_items (id, sale_id, product_id, product_name, quantity, unit_price, buying_price) VALUES ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-00000000aa01', '00000000-0000-0000-0000-00000000bb01', 'Riz', 2, 500, 400);
INSERT INTO public.sale_item_batches (sale_item_id, quantity) VALUES ('00000000-0000-0000-0000-00000000cc01', 2);
SQL
P -d "$1" -f "$SEED" >/dev/null
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL "$1")" --workdir "$WORK/main" > "$WORK/repair-$1.log" || { echo "repair local impossible"; cat "$WORK/repair-$1.log"; exit 2; }
}
ACL() { P -d "$1" -c "select string_agg(x, ' | ' order by x) from (select c.relname || ':' || coalesce(array_to_string(c.relacl, ','), '') as x from pg_class c where c.relname in ('products','product_batches','sale_items') and c.relnamespace = 'public'::regnamespace union all select c.relname || '.' || a.attname || ':' || array_to_string(a.attacl, ',') from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname in ('products','product_batches','sale_items') and c.relnamespace = 'public'::regnamespace and a.attacl is not null) t"; }
RP() { P -d "$1" -c "select md5(string_agg(id::text || '=' || coalesce(role_permissions::text, 'NULL'), ';' order by id)) from public.shops"; }
HIST() { P -d "$1" -c "select coalesce(string_agg(version || ':' || name, ' ' order by version), '') from supabase_migrations.schema_migrations where version >= '181'"; }

echo "── 1. Base jetable « c2val » : copie du schéma utile + réglages réels, historique 001 → 180 enregistré"
schema c2val
ok "$(P -d c2val -c "select count(*) from supabase_migrations.schema_migrations")" "$(echo $OLD_VERSIONS | wc -w)" "historique local : $(echo $OLD_VERSIONS | wc -w) versions (comme la production)"
LIST="$(CLI migration list --db-url "$(URL c2val)" --workdir "$WORK/main")"
ok "$(echo "$LIST" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.filter(m=>m.local&&!m.remote).map(m=>m.local).join(' ')+' / '+j.migrations.filter(m=>!m.local&&m.remote).length)")" "181 182 / 0" "migration list : seules 181 et 182 en attente, rien de distant seul"
DRY="$(CLI db push --dry-run --db-url "$(URL c2val)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "181_view_purchase_cost_permission.sql 182_c2_cost_columns_server_only.sql" "db push --dry-run : exactement 181 puis 182"
ACL0="$(ACL c2val)"; RP0="$(RP c2val)"

echo "── 2. db push (fichiers exacts)"
PUSH="$(CLI db push --yes --db-url "$(URL c2val)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|WARNING|ERROR" | sed 's/^/      /'
ok "$(HIST c2val)" "181:view_purchase_cost_permission 182:c2_cost_columns_server_only" "historique : 181 et 182 enregistrées (nom)"
ok "$(P -d c2val -c "select bool_and(coalesce(array_length(statements,1),0) > 0) from supabase_migrations.schema_migrations where version in ('181','182')")" "t" "historique : instructions enregistrées"
ok "$(echo "$PUSH" | grep -c "SET LOCAL can only be used")" "0" "SET LOCAL lock_timeout : dans la transaction de la CLI (aucun avertissement)"

echo "── 3. 181 : 3 réglages, accès identiques"
ok "$(P -d c2val -c "select string_agg(s.id::text || ':' || e.k, ' ' order by s.id::text) from public.shops s, jsonb_each(coalesce(s.role_permissions, '{}')) e(k, v) where jsonb_typeof(v) = 'object' and v ? 'view_purchase_cost' and (v ->> 'view_purchase_cost') = 'true'")" \
   "abec3e3f-3e92-4ff0-a374-d2d88f57899b:stock_manager bdf511df-a716-4c05-b1b2-0634d53e256c:cashier f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0:stock_manager" "exactement les 3 couples (boutique, rôle) attendus, valeur true"
ok "$(P -d c2val -c "select count(*) from public.shops s where s.id not in ('abec3e3f-3e92-4ff0-a374-d2d88f57899b','bdf511df-a716-4c05-b1b2-0634d53e256c','f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0') and s.role_permissions::text like '%view_purchase_cost%'")" "0" "aucune autre boutique touchée"
ok "$(P -d c2val -c "select (role_permissions - 'cashier') = (select (role_permissions - 'cashier') from public.shops where id = 'bdf511df-a716-4c05-b1b2-0634d53e256c') and true from public.shops where id = 'bdf511df-a716-4c05-b1b2-0634d53e256c'")" "t" "SOFAR WATCHES : seuls les réglages du rôle cashier changent"
ok "$(P -d c2val -c "select string_agg(coalesce(role_permissions::text,'NULL'), ' | ' order by id) from public.shops where id in ('abec3e3f-3e92-4ff0-a374-d2d88f57899b','f64a1b6c-f6c6-4f09-90af-d90bcde5f0c0')")" \
   '{"stock_manager": {"view_purchase_cost": true}} | {"stock_manager": {"view_purchase_cost": true}}' "Bastos (×2) : réglage NULL → seulement stock_manager.view_purchase_cost = true"

echo "── 4. 182 : droits effectifs par colonne"
R() { P -d c2val -c "set role $1; $2" 2>&1 | tail -1; }
ok "$(R authenticated "select name || '/' || selling_price || '/' || quantity from public.products limit 1")" "Riz/500/10" "authenticated : colonnes permises lisibles"
ok "$(R authenticated "select buying_price from public.products limit 1" | grep -c 'permission denied')" "1" "authenticated : buying_price refusé (products)"
ok "$(R authenticated "select * from public.products limit 1" | grep -c 'permission denied')" "1" "authenticated : « * » refusé (products)"
ok "$(R authenticated "select buying_price from public.product_batches limit 1" | grep -c 'permission denied')" "1" "authenticated : buying_price refusé (product_batches)"
ok "$(R authenticated "select buying_price from public.sale_items limit 1" | grep -c 'permission denied')" "1" "authenticated : buying_price refusé (sale_items)"
ok "$(R authenticated "select count(*) from public.products")" "1" "authenticated : count(*) (comptages HEAD) fonctionne"
ok "$(R authenticated "select si.product_name || '/' || si.subtotal from public.sales s join public.sale_items si on si.sale_id = s.id")" "Riz/1000" "authenticated : ventes + lignes imbriquées sans coût"
ok "$(R authenticated "select count(*) from public.sale_item_batches")" "1" "authenticated : règle RLS de sale_item_batches (lit sale_items.id / sale_id) intacte"
ok "$(R authenticated "select product_count || '/' || stock_value from public.shop_stats_test")" "1/5000" "authenticated : vue security_invoker sans coût intacte"
ok "$(R anon "select id from public.products limit 1" | grep -c 'permission denied')" "1" "anon : aucune lecture"
ok "$(R service_role "select buying_price from public.products limit 1")" "400" "service_role : coût lisible (serveur)"
ok "$(P -d c2val -c "select string_agg(r || ':' || has_table_privilege(r, t, 'SELECT'), ' ' order by r, t) from unnest(array['authenticated','anon']) r, unnest(array['public.products','public.product_batches','public.sale_items']) t")" \
   "anon:false anon:false anon:false authenticated:false authenticated:false authenticated:false" "aucun SELECT de TABLE pour authenticated / anon"
ok "$(P -d c2val -c "select has_column_privilege('authenticated','public.products','id','SELECT') || '/' || has_column_privilege('authenticated','public.products','buying_price','SELECT')")" "true/false" "temps réel (has_column_privilege) : id lisible, buying_price retiré du message"
P -d c2val -c "alter table public.products add column zz_future int" >/dev/null
ok "$(P -d c2val -c "select has_column_privilege('authenticated','public.products','zz_future','SELECT')::text")" "false" "fail-closed : une colonne ajoutée plus tard est illisible sans son GRANT"
P -d c2val -c "alter table public.products drop column zz_future" >/dev/null
ok "$(P -d c2val -c "select has_column_privilege('authenticated','public.products','buying_price','UPDATE')::text")" "true" "écritures : droits de table inchangés (la RLS les refuse, aucune règle d'écriture)"

echo "── 5. Retours arrière exacts"
P -d c2val -f "$REPO/supabase/rollbacks/182_c2_cost_columns_server_only_rollback.sql" >/dev/null
ok "$(ACL c2val)" "$ACL0" "rollback 182 : droits IDENTIQUES à avant la 182"
P -d c2val -f "$REPO/supabase/rollbacks/181_view_purchase_cost_permission_rollback.sql" >/dev/null 2>&1
ok "$(RP c2val)" "$RP0" "rollback 181 : réglages IDENTIQUES à avant la 181 (Bastos redevenus NULL)"

echo "── 6. Échecs : rien d'écrit"
schema c2fail1
P -d c2fail1 -c "insert into public.shop_members (shop_id, role, is_active) values ('544040ba-9759-4779-be9e-ec2346fcb931', 'cashier', true)" >/dev/null
ACLb="$(ACL c2fail1)"; RPb="$(RP c2fail1)"
OUT="$(CLI db push --yes --db-url "$(URL c2fail1)" --workdir "$WORK/main")"
ok "$(echo "$OUT" | grep -c "181 : couples à conserver attendus")" "1" "données changées (un caissier réel ajouté à une boutique) : 181 s'arrête avec le message prévu"
ok "$(HIST c2fail1)|$(RP c2fail1)|$(ACL c2fail1)" "|$RPb|$ACLb" "→ aucun réglage écrit, ni 181 ni 182 dans l'historique, droits inchangés"
schema c2fail2
P -d c2fail2 -c "grant select (buying_price) on public.products to public" >/dev/null
ACLb="$(ACL c2fail2)"
OUT="$(CLI db push --yes --db-url "$(URL c2fail2)" --workdir "$WORK/main")"
ok "$(echo "$OUT" | grep -c "182 : droits de colonne inattendus")" "1" "droit hérité de PUBLIC sur buying_price : le garde-fou de la 182 l'attrape (has_column_privilege effectif)"
ok "$(HIST c2fail2)|$(ACL c2fail2)" "181:view_purchase_cost_permission|$ACLb" "→ 182 annulée entière (REVOKE / GRANT défaits, absente de l'historique) ; 181 reste appliquée (transaction par fichier)"

echo "── 7. Atomicité de la CLI et verrous"
mkdir -p "$WORK/fail/supabase/migrations"; cp "$WORK/main/supabase/migrations/"*.sql "$WORK/fail/supabase/migrations/"
printf "CREATE TABLE public.zz_atomic (x int);\nINSERT INTO public.zz_atomic VALUES (1);\nSELECT 1/0;\n" > "$WORK/fail/supabase/migrations/183_atomic_probe.sql"
schema c2atom; CLI db push --yes --db-url "$(URL c2atom)" --workdir "$WORK/main" >/dev/null
OUT="$(CLI db push --yes --db-url "$(URL c2atom)" --workdir "$WORK/fail")"
ok "$(P -d c2atom -c "select to_regclass('public.zz_atomic') is null")|$(P -d c2atom -c "select count(*) from supabase_migrations.schema_migrations where version = '183'")" "t|0" "migration qui échoue à mi-chemin : tout est défait (table absente, version non enregistrée)"
schema c2base
t0=$(date +%s%N); CLI db push --yes --db-url "$(URL c2base)" --workdir "$WORK/main" >/dev/null; t1=$(date +%s%N)
base=$(( (t1 - t0) / 1000000 )); echo "      db push sans lecture en cours (référence) : ${base} ms"
schema c2lock
( P -d c2lock -c "begin; select count(*) from public.products; select pg_sleep(3); commit;" >/dev/null ) & HOLD=$!
sleep 0.5; t0=$(date +%s%N); CLI db push --yes --db-url "$(URL c2lock)" --workdir "$WORK/main" >/dev/null; t1=$(date +%s%N); wait $HOLD
ms=$(( (t1 - t0) / 1000000 ))
echo "      db push pendant une lecture ouverte de 3 s : ${ms} ms (écart avec la référence : $(( ms - base )) ms)"
ok "$(HIST c2lock)" "181:view_purchase_cost_permission 182:c2_cost_columns_server_only" "pendant une lecture en cours : 181 et 182 appliquées"

for d in c2val c2fail1 c2fail2 c2atom c2base c2lock; do P -d postgres -c "drop database if exists $d" >/dev/null; done
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
