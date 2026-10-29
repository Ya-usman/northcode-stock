#!/bin/bash
# Validation LOCALE de 185 (ventes, paiements, lignes, clients, réservations lus selon le droit du rôle) — base
# PostgreSQL jetable UNIQUEMENT, jamais la production. Applique le fichier EXACT du dépôt avec la CLI Supabase (db push).
# Usage (racine du dépôt) : bash supabase/drafts/185_local_validation.sh
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
ok "$(sha256sum "$WORK/main/supabase/migrations/185_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/185_"*.sql | cut -c1-64)" "copie exacte de la 185"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 185 | tr '\n' ' ')"
# Fonctions de droits de la 184 (déjà en production) : reprises telles quelles de son fichier
sed -n '/^-- Valeur de vérité/,/^GRANT EXECUTE ON FUNCTION public.perm_jsonb_truthy/p' "$REPO/supabase/migrations/184_d2_feature_read_rls.sql" > "$WORK/184-fonctions.sql"

A=a0000000-0000-0000-0000-00000000000a; B=a0000000-0000-0000-0000-00000000000b
OWNER=10000000-0000-0000-0000-000000000001; MANAGER=10000000-0000-0000-0000-000000000002; CASHIER=10000000-0000-0000-0000-000000000003
STOCKM=10000000-0000-0000-0000-000000000004; VIEWER=10000000-0000-0000-0000-000000000005; SHOPM=10000000-0000-0000-0000-000000000006
GONE=10000000-0000-0000-0000-000000000007; OUTSIDER=10000000-0000-0000-0000-000000000008
USERS="$OWNER $MANAGER $CASHIER $STOCKM $VIEWER $SHOPM $GONE $OUTSIDER"

schema() {
P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
P -d "$1" <<SQL || { echo "schéma local impossible (données de départ)"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, role_permissions jsonb);
CREATE TABLE public.shop_members (shop_id uuid, user_id uuid, role text NOT NULL, is_active boolean DEFAULT true);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, shop_id uuid, role text);
-- Fonctions d'appartenance, EXACTEMENT comme en production
CREATE FUNCTION public.is_shop_member(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS \$f\$
  SELECT EXISTS (SELECT 1 FROM shop_members WHERE shop_id = p_shop_id AND user_id = auth.uid() AND is_active = true) \$f\$;
CREATE FUNCTION public.get_role_in_shop(p_shop_id uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS \$f\$
  SELECT COALESCE((SELECT role FROM shop_members WHERE shop_id = p_shop_id AND user_id = auth.uid() AND is_active = true LIMIT 1),
                  (SELECT role FROM profiles WHERE id = auth.uid() AND shop_id = p_shop_id LIMIT 1)) \$f\$;
CREATE TABLE public.sales (id text PRIMARY KEY, shop_id uuid, cashier_id uuid);
CREATE TABLE public.payments (id text PRIMARY KEY, sale_id text, amount numeric);
CREATE TABLE public.sale_items (id text PRIMARY KEY, sale_id text);
CREATE TABLE public.customers (id text PRIMARY KEY, shop_id uuid, deleted_at timestamptz);
CREATE TABLE public.stock_reservations (id text PRIMARY KEY, shop_id uuid);
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
-- Règles de lecture d'avant, EXACTEMENT comme en production (pg_policies du 29 oct. 2026)
CREATE POLICY sales_owner_all_read ON public.sales FOR SELECT
  USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text]));
CREATE POLICY sales_viewer_select ON public.sales FOR SELECT USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'viewer'::text);
CREATE POLICY sales_cashier_own ON public.sales FOR SELECT USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'cashier'::text AND cashier_id = auth.uid());
CREATE POLICY sales_stock_manager_own ON public.sales FOR SELECT USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'stock_manager'::text AND cashier_id = auth.uid());
CREATE POLICY payments_member_select ON public.payments FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id AND is_shop_member(s.shop_id)));
CREATE POLICY payments_owner_all_read ON public.payments FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id AND is_shop_member(s.shop_id) AND get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text])));
CREATE POLICY sale_items_member_select ON public.sale_items FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_shop_member(s.shop_id)));
CREATE POLICY sale_items_owner_all_read ON public.sale_items FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_shop_member(s.shop_id) AND get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text])));
CREATE POLICY sale_items_owner_write_read ON public.sale_items FOR SELECT USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND get_role_in_shop(s.shop_id) = 'owner'::text));
CREATE POLICY customers_shop_select ON public.customers FOR SELECT USING (is_shop_member(shop_id) AND deleted_at IS NULL);
CREATE POLICY stock_reservations_select ON public.stock_reservations FOR SELECT USING (is_shop_member(shop_id));
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- Boutique A : sans réglage. Boutique B : Manager sans Historique ni Caisse ; Observateur sans Historique ni Clients
INSERT INTO public.shops VALUES ('$A', NULL),
  ('$B', '{"manager": {"sales_history": false, "caisse": false}, "viewer": {"sales_history": false, "customers": false}}');
INSERT INTO public.shop_members VALUES
  ('$A', '$OWNER', 'owner', true), ('$B', '$OWNER', 'owner', true), ('$A', '$MANAGER', 'manager', true), ('$B', '$MANAGER', 'manager', true),
  ('$A', '$CASHIER', 'cashier', true), ('$A', '$STOCKM', 'stock_manager', true), ('$A', '$VIEWER', 'viewer', true), ('$B', '$VIEWER', 'viewer', true),
  ('$A', '$SHOPM', 'shop_manager', true), ('$A', '$GONE', 'manager', false);
INSERT INTO public.sales VALUES ('s1', '$A', '$CASHIER'), ('s2', '$A', '$MANAGER'), ('s3', '$A', '$OWNER'), ('s4', '$A', '$STOCKM'),
  ('s5', '$B', '$MANAGER'), ('s6', '$B', '$OWNER');
INSERT INTO public.payments SELECT 'p' || substr(id, 2), id, 100 FROM public.sales;
INSERT INTO public.sale_items SELECT 'i' || substr(id, 2), id FROM public.sales;
INSERT INTO public.customers VALUES ('c1', '$A', NULL), ('c2', '$A', now()), ('c3', '$B', NULL);
INSERT INTO public.stock_reservations VALUES ('r1', '$A'), ('r2', '$B');
SQL
P -d "$1" -f "$WORK/184-fonctions.sql" >/dev/null || { echo "fonctions de la 184 impossibles"; exit 2; }
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL "$1")" --workdir "$WORK/main" > "$WORK/repair-$1.log" || { echo "repair local impossible"; cat "$WORK/repair-$1.log"; exit 2; }
}
POL() { P -d "$1" -c "select string_agg(tablename || '.' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, ''), ' | ' order by tablename, policyname) from pg_policies where schemaname = 'public'"; }
HIST() { P -d "$1" -c "select coalesce(string_agg(version || ':' || name, ' ' order by version), '') from supabase_migrations.schema_migrations where version >= '185'"; }
AS() { P -d r185 -c "set role $1; set request.jwt.claim.sub = '${3:-}'; $2" 2>&1 | tail -1; }
# Identifiants lus par chaque utilisateur, table par table (ventes / paiements / lignes / clients / réservations)
SEEN() { for u in $USERS; do
  echo -n "$(AS authenticated "select (select coalesce(string_agg(id, ',' order by id), '-') from sales) || '/' || (select coalesce(string_agg(id, ',' order by id), '-') from payments) || '/' || (select coalesce(string_agg(id, ',' order by id), '-') from sale_items) || '/' || (select coalesce(string_agg(id, ',' order by id), '-') from customers) || '/' || (select coalesce(string_agg(id, ',' order by id), '-') from stock_reservations)" "$u") "
done; }

echo "── 1. Base jetable « r185 » (fonctions de la 184 en place), historique 001 → 184 enregistré"
schema r185
ok "$(P -d r185 -c "select count(*) from supabase_migrations.schema_migrations")" "$(echo $OLD_VERSIONS | wc -w)" "historique local : $(echo $OLD_VERSIONS | wc -w) versions (comme la production)"
DRY="$(CLI db push --dry-run --db-url "$(URL r185)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "185_d2_sales_read_rls.sql" "db push --dry-run : exactement la 185"
POL0="$(POL r185)"; BEFORE="$(SEEN)"
#              propriétaire                    manager                         caissier          magasinier        observateur                      responsable              inactif   étranger
EXPECT_BEFORE="s1,s2,s3,s4,s5,s6/p1,p2,p3,p4,p5,p6/i1,i2,i3,i4,i5,i6/c1,c3/r1,r2 s1,s2,s3,s4,s5,s6/p1,p2,p3,p4,p5,p6/i1,i2,i3,i4,i5,i6/c1,c3/r1,r2 s1/p1/i1/c1/r1 s4/p4/i4/c1/r1 s1,s2,s3,s4,s5,s6/p1,p2,p3,p4,p5,p6/i1,i2,i3,i4,i5,i6/c1,c3/r1,r2 s1,s2,s3,s4/p1,p2,p3,p4/i1,i2,i3,i4/c1/r1 -/-/-/-/- -/-/-/-/- "
ok "$BEFORE" "$EXPECT_BEFORE" "AVANT : appartenance seule (caissier et magasinier : leurs ventes)"

echo "── 2. db push"
PUSH="$(CLI db push --yes --db-url "$(URL r185)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|WARNING|ERROR" | sed 's/^/      /'
ok "$(HIST r185)" "185:d2_sales_read_rls" "historique : 185 enregistrée"
ok "$(echo "$PUSH" | grep -c "SET LOCAL can only be used")" "0" "SET LOCAL lock_timeout dans la transaction de la CLI"

echo "── 3. Lectures après la 185 (navigateur = authenticated)"
AFTER="$(SEEN)"
EXPECT_AFTER="s1,s2,s3,s4,s5,s6/p1,p2,p3,p4,p5,p6/i1,i2,i3,i4,i5,i6/c1,c3/r1,r2 s1,s2,s3,s4,s5/p1,p2,p3,p4/i1,i2,i3,i4,i5/c1,c3/r1,r2 s1/p1/i1/c1/r1 -/-/-/-/r1 s1,s2,s3,s4/p1,p2,p3,p4/i1,i2,i3,i4/c1,c3/r1,r2 s1,s2,s3,s4/p1,p2,p3,p4/i1,i2,i3,i4/c1/r1 -/-/-/-/- -/-/-/-/- "
ok "$AFTER" "$EXPECT_AFTER" "APRÈS : selon les droits (détail ci-dessous)"
echo "      propriétaire : tout (ses 2 boutiques) · manager : A tout ; B sans Historique ni Caisse → SA vente s5 (Vendre), sans"
echo "      paiement · caissier : sa vente, comme avant · magasinier (ni Vendre, ni Historique, ni Clients) : réservations seules"
echo "      · observateur : A tout ; B sans Historique → aucune vente, mais clients de B (Crédits) · inactif, étranger : rien"
# Personne ne lit après ce qu'il ne lisait pas avant (aucun gain), utilisateur par utilisateur et table par table
GAIN="$(node -e "
const [b, a] = [process.argv[1], process.argv[2]].map(s => s.trim().split(' ').map(u => u.split('/').map(t => t === '-' ? [] : t.split(','))))
const out = []; a.forEach((u, i) => u.forEach((t, j) => t.forEach(id => { if (!b[i][j].includes(id)) out.push(id) })))
console.log(out.join(',') || 'aucun')" "$BEFORE" "$AFTER")"
ok "$GAIN" "aucun" "aucune ligne lisible APRÈS qui ne l'était pas AVANT (aucun gain, pour aucun utilisateur)"
ok "$(AS service_role "select (select count(*) from sales) || '/' || (select count(*) from payments) || '/' || (select count(*) from sale_items) || '/' || (select count(*) from customers) || '/' || (select count(*) from stock_reservations)")" "6/6/6/3/2" "service_role (serveur) : tout lisible, inchangé"
ok "$(AS anon "select count(*) from sales")/$(AS anon "select count(*) from customers")" "0/0" "anon : rien"
ok "$(AS anon "select count(*) from public.shop_ids_with_any_feature(array['stock'])" | grep -c 'permission denied')" "1" "anon : fonction des droits non exécutable"
P -d r185 -c "update public.shops set role_permissions = '{\"cashier\": {\"new_sale\": false, \"sales_history\": false, \"customers\": false, \"payments\": false}}' where id = '$A'" >/dev/null
ok "$(AS authenticated "select (select count(*) from sales) || '/' || (select count(*) from customers)" "$CASHIER")" "0/0" "réglage changé (caissier sans Vendre ni Historique ni Clients ni Crédits) : effet immédiat"
P -d r185 -c "update public.shops set role_permissions = NULL where id = '$A'" >/dev/null
PLAN="$(P -d r185 -c "set role authenticated; set request.jwt.claim.sub = '$OWNER'; explain select * from sales")"
ok "$(echo "$PLAN" | grep -ciE 'hashed SubPlan|Hash (Semi )?Join|InitPlan' | awk '{print ($1>0)}')" "1" "plan : fonction des droits évaluée une fois par requête"

echo "── 4. Retour arrière exact"
P -d r185 -f "$REPO/supabase/rollbacks/185_d2_sales_read_rls_rollback.sql" >/dev/null
ok "$(POL r185)" "$POL0" "rollback 185 : règles de lecture IDENTIQUES à avant"
ok "$(P -d r185 -c "select count(*) from pg_proc where proname = 'shop_ids_with_any_feature'")" "0" "rollback 185 : fonction retirée"
ok "$(SEEN)" "$EXPECT_BEFORE" "rollback 185 : lectures comme AVANT"

echo "── 5. Échec : règle de lecture inattendue sur les ventes"
schema r185fail
P -d r185fail -c "create policy zz_extra_select on public.sales for select using (true)" >/dev/null
POLb="$(POL r185fail)"
OUT="$(CLI db push --yes --db-url "$(URL r185fail)" --workdir "$WORK/main")"
ok "$(echo "$OUT" | grep -c "185 : autre règle de lecture restante : sales.zz_extra_select")" "1" "règle supplémentaire : le garde-fou l'attrape"
ok "$(HIST r185fail)|$(POL r185fail)" "|$POLb" "→ 185 annulée entière (absente de l'historique, règles inchangées)"

for d in r185 r185fail; do P -d postgres -c "drop database if exists $d" >/dev/null; done
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
