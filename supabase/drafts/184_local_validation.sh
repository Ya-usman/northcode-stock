#!/bin/bash
# Validation LOCALE de 184 (lectures selon le droit du rôle) — base PostgreSQL jetable UNIQUEMENT, jamais la production.
# Applique le fichier EXACT du dépôt avec la CLI Supabase (db push), comme en production.
# Usage (racine du dépôt) : [REAL=<réglages.json>] bash supabase/drafts/184_local_validation.sh
#   REAL : réglages réels relevés en lecture seule par supabase/drafts/184_configs_from_prod.js (facultatif)
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
ok "$(sha256sum "$WORK/main/supabase/migrations/184_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/184_"*.sql | cut -c1-64)" "copie exacte de la 184"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 184 | tr '\n' ' ')"

# Boutiques : A sans réglage ; B caissier avec « Dépenses » ; C « Dépenses » masquée dans « Général »
A=a0000000-0000-0000-0000-00000000000a; B=a0000000-0000-0000-0000-00000000000b; C=a0000000-0000-0000-0000-00000000000c
OWNER=10000000-0000-0000-0000-000000000001; CASHIER=10000000-0000-0000-0000-000000000002; MANAGER=10000000-0000-0000-0000-000000000003
VIEWER=10000000-0000-0000-0000-000000000004; STOCKM=10000000-0000-0000-0000-000000000005; GONE=10000000-0000-0000-0000-000000000006
OUTSIDER=10000000-0000-0000-0000-000000000007

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
CREATE TABLE public.shops (id uuid PRIMARY KEY, role_permissions jsonb);
CREATE TABLE public.shop_members (shop_id uuid, user_id uuid, role text NOT NULL, is_active boolean DEFAULT true);
CREATE FUNCTION public.is_shop_member(p_shop_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS \$f\$
  SELECT EXISTS (SELECT 1 FROM shop_members WHERE shop_id = p_shop_id AND user_id = auth.uid() AND is_active = true) \$f\$;
CREATE TABLE public.expenses (id serial PRIMARY KEY, shop_id uuid, amount numeric);
CREATE TABLE public.expense_budgets (id serial PRIMARY KEY, shop_id uuid, amount numeric);
CREATE TABLE public.stock_movements (id serial PRIMARY KEY, shop_id uuid, quantity int);
CREATE TABLE public.stock_transfers (id serial PRIMARY KEY, source_shop_id uuid, destination_shop_id uuid);
CREATE TABLE public.stock_transfer_items (id serial PRIMARY KEY, stock_transfer_id int);
CREATE TABLE public.sales (id serial PRIMARY KEY, shop_id uuid);
CREATE TABLE public.sale_items (id serial PRIMARY KEY, sale_id int);
CREATE TABLE public.sale_item_batches (id serial PRIMARY KEY, sale_item_id int);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY; ALTER TABLE public.expense_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY; ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.sale_item_batches ENABLE ROW LEVEL SECURITY;
-- Règles de lecture d'avant, EXACTEMENT comme en production (pg_policies du 25 oct. 2026)
CREATE POLICY expenses_member_select ON public.expenses FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY expense_budgets_member_select ON public.expense_budgets FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_movements_member_select ON public.stock_movements FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_transfers_select ON public.stock_transfers FOR SELECT USING (is_shop_member(source_shop_id) OR is_shop_member(destination_shop_id));
CREATE POLICY stock_transfer_items_select ON public.stock_transfer_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM stock_transfers st WHERE st.id = stock_transfer_items.stock_transfer_id AND (is_shop_member(st.source_shop_id) OR is_shop_member(st.destination_shop_id))));
CREATE POLICY sale_item_batches_select ON public.sale_item_batches FOR SELECT
  USING (EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)));
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
-- Comme sur Supabase : droits par défaut sur les fonctions créées ensuite (la 184 doit les retirer elle-même)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
REVOKE SELECT ON public.stock_transfer_items FROM authenticated; -- comme en production
INSERT INTO public.shops VALUES ('$A', NULL), ('$B', '{"cashier": {"expenses": true}, "general": {}}'), ('$C', '{"general": {"expenses": false}}');
INSERT INTO public.shop_members VALUES
  ('$A', '$OWNER', 'owner', true), ('$B', '$OWNER', 'owner', true), ('$C', '$OWNER', 'owner', true),
  ('$A', '$CASHIER', 'cashier', true), ('$B', '$CASHIER', 'cashier', true),
  ('$A', '$MANAGER', 'manager', true), ('$C', '$MANAGER', 'manager', true),
  ('$A', '$VIEWER', 'viewer', true), ('$A', '$STOCKM', 'stock_manager', true), ('$A', '$GONE', 'manager', false);
INSERT INTO public.expenses (shop_id, amount) VALUES ('$A', 100), ('$B', 200), ('$C', 300);
INSERT INTO public.expense_budgets (shop_id, amount) VALUES ('$A', 1000), ('$B', 2000), ('$C', 3000);
INSERT INTO public.stock_movements (shop_id, quantity) VALUES ('$A', 5), ('$B', 6);
INSERT INTO public.stock_transfers (source_shop_id, destination_shop_id) VALUES ('$A', '$B');
INSERT INTO public.stock_transfer_items (stock_transfer_id) VALUES (1);
INSERT INTO public.sales (shop_id) VALUES ('$A'); INSERT INTO public.sale_items (sale_id) VALUES (1); INSERT INTO public.sale_item_batches (sale_item_id) VALUES (1);
SQL
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL "$1")" --workdir "$WORK/main" > "$WORK/repair-$1.log" || { echo "repair local impossible"; cat "$WORK/repair-$1.log"; exit 2; }
}
POL() { P -d "$1" -c "select string_agg(tablename || '.' || policyname || ':' || permissive || ':' || roles::text || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ' | ' order by tablename, policyname) from pg_policies where schemaname = 'public'"; }
FUN() { P -d "$1" -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('perm_jsonb_truthy', 'role_can_view_feature', 'shop_ids_with_feature')"; }
HIST() { P -d "$1" -c "select coalesce(string_agg(version || ':' || name, ' ' order by version), '') from supabase_migrations.schema_migrations where version >= '184'"; }
AS() { P -d r184 -c "set role $1; set request.jwt.claim.sub = '${3:-}'; $2" 2>&1 | tail -1; }
SEEN() { # nombre de lignes lues par chaque utilisateur : dépenses / budgets / mouvements / transferts / affectations
  for u in "$OWNER" "$CASHIER" "$MANAGER" "$VIEWER" "$STOCKM" "$GONE" "$OUTSIDER"; do
    echo -n "$(AS authenticated "select (select count(*) from expenses) || '/' || (select count(*) from expense_budgets) || '/' || (select count(*) from stock_movements) || '/' || (select count(*) from stock_transfers) || '/' || (select count(*) from sale_item_batches)" "$u") "
  done
}

echo "── 1. Base jetable « r184 », historique 001 → 183 enregistré"
schema r184
ok "$(P -d r184 -c "select count(*) from supabase_migrations.schema_migrations")" "$(echo $OLD_VERSIONS | wc -w)" "historique local : $(echo $OLD_VERSIONS | wc -w) versions (comme la production)"
DRY="$(CLI db push --dry-run --db-url "$(URL r184)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "184_d2_feature_read_rls.sql" "db push --dry-run : exactement la 184"
POL0="$(POL r184)"
#               propriétaire  caissier    manager     observateur  magasinier  inactif     étranger
ok "$(SEEN)" "3/3/2/1/1 2/2/2/1/1 2/2/1/1/1 1/1/1/1/1 1/1/1/1/1 0/0/0/0/0 0/0/0/0/0 " "AVANT : tout membre lit dépenses, budgets, mouvements, transferts, affectations de sa boutique"

echo "── 2. db push"
PUSH="$(CLI db push --yes --db-url "$(URL r184)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|WARNING|ERROR" | sed 's/^/      /'
ok "$(HIST r184)" "184:d2_feature_read_rls" "historique : 184 enregistrée"
ok "$(echo "$PUSH" | grep -c "SET LOCAL can only be used")" "0" "SET LOCAL lock_timeout dans la transaction de la CLI"

echo "── 3. Lectures après la 184 (navigateur = authenticated)"
ok "$(SEEN)" "3/3/0/0/0 1/1/0/0/0 1/1/0/0/0 0/0/0/0/0 0/0/0/0/0 0/0/0/0/0 0/0/0/0/0 " "APRÈS : dépenses selon le droit ; mouvements, transferts, affectations : rien"
ok "$(AS authenticated "select string_agg(amount::text, ',' order by amount) from expenses" "$OWNER")" "100,200,300" "propriétaire : ses 3 boutiques, y compris C où « Dépenses » est masquée dans « Général » (décision 1)"
ok "$(AS authenticated "select string_agg(amount::text, ',') from expenses" "$CASHIER")" "200" "caissier : seulement B (droit accordé) — pas A (défaut : non)"
ok "$(AS authenticated "select string_agg(amount::text, ',') from expenses" "$MANAGER")" "100" "manager : A (défaut : oui) — pas C (masquée pour tout le monde)"
ok "$(AS authenticated "select count(*) from expenses where shop_id = '$B'" "$MANAGER")" "0" "manager : rien dans une boutique dont il n'est pas membre"
ok "$(AS authenticated "select count(*) from stock_transfer_items" "$OWNER" | grep -c 'permission denied')" "1" "lignes de transfert : toujours refusées (droit de table retiré, comme avant)"
ok "$(AS service_role "select (select count(*) from expenses) || '/' || (select count(*) from stock_movements) || '/' || (select count(*) from stock_transfers) || '/' || (select count(*) from stock_transfer_items) || '/' || (select count(*) from sale_item_batches)")" "3/2/1/1/1" "service_role (serveur) : tout lisible, inchangé"
ok "$(AS anon "select count(*) from expenses")" "0" "anon : aucune dépense"
ok "$(AS anon "select count(*) from public.shop_ids_with_feature('expenses')" | grep -c 'permission denied')" "1" "anon : fonction des droits non exécutable"
ok "$(AS authenticated "select count(*) from public.role_can_view_feature(null, 'manager', 'expenses')" "$OWNER" | grep -c 'permission denied')" "1" "authenticated : règle interne non exécutable directement"
ok "$(AS authenticated "select string_agg(x::text, ',' order by x::text) from public.shop_ids_with_feature('expenses') x" "$CASHIER")" "$B" "authenticated : ses propres boutiques autorisées seulement"
P -d r184 -c "update public.shops set role_permissions = '{\"cashier\": {\"expenses\": false}}' where id = '$B'" >/dev/null
ok "$(AS authenticated "select count(*) from expenses" "$CASHIER")" "0" "changement de réglage : effet immédiat, sans reconnexion"
P -d r184 -c "update public.shops set role_permissions = '{\"cashier\": {\"expenses\": true}, \"general\": {}}' where id = '$B'" >/dev/null
PLAN="$(P -d r184 -c "set role authenticated; set request.jwt.claim.sub = '$OWNER'; explain select * from expenses")"
ok "$(echo "$PLAN" | grep -ciE 'hashed SubPlan|Hash (Semi )?Join|InitPlan' | awk '{print ($1>0)}')" "1" "plan : fonction des droits évaluée une fois par requête (pas ligne par ligne)"

echo "── 4. Règle SQL = règle de l'application (lib/permissions), cas par cas"
node "$REPO/supabase/drafts/184_rule_cases.mjs" ${REAL:-} > "$WORK/cases.tsv" 2> "$WORK/cases.log"; cat "$WORK/cases.log" | grep -v "Warning\|Reparsing\|eliminate\|trace-warn" | sed 's/^/      /'
P -d r184 -c "create table cases (stored jsonb, role text, feature text, want boolean)" >/dev/null
P -d r184 -c "\\copy cases from '$(cygpath -w "$WORK/cases.tsv" 2>/dev/null || echo "$WORK/cases.tsv")'" >/dev/null
N="$(P -d r184 -c "select count(*) from cases")"
ok "$(P -d r184 -c "select count(*) from cases where public.role_can_view_feature(stored, role, feature) is distinct from want")" "0" "$N cas comparés : 0 différence"
P -d r184 -c "select role, feature, left(coalesce(stored::text, 'null'), 80), want from cases where public.role_can_view_feature(stored, role, feature) is distinct from want limit 5" | sed 's/^/      /'
ok "$(P -d r184 -c "select count(*) from cases where want")/$(P -d r184 -c "select count(*) from cases where not want")" "$(awk -F'\t' '$4=="true"' "$WORK/cases.tsv" | wc -l)/$(awk -F'\t' '$4=="false"' "$WORK/cases.tsv" | wc -l)" "les deux issues (oui / non) sont bien représentées"

echo "── 5. Retour arrière exact"
P -d r184 -c "drop table cases" >/dev/null
P -d r184 -f "$REPO/supabase/rollbacks/184_d2_feature_read_rls_rollback.sql" >/dev/null
ok "$(POL r184)" "$POL0" "rollback 184 : règles de lecture IDENTIQUES à avant"
ok "$(FUN r184)" "0" "rollback 184 : fonctions de droits retirées"
ok "$(SEEN)" "3/3/2/1/1 2/2/2/1/1 2/2/1/1/1 1/1/1/1/1 1/1/1/1/1 0/0/0/0/0 0/0/0/0/0 " "rollback 184 : lectures comme AVANT"

echo "── 6. Échec : règle de lecture inattendue sur les mouvements"
schema r184fail
P -d r184fail -c "create policy zz_extra_select on public.stock_movements for select using (true)" >/dev/null
POLb="$(POL r184fail)"
OUT="$(CLI db push --yes --db-url "$(URL r184fail)" --workdir "$WORK/main")"
ok "$(echo "$OUT" | grep -c "184 : règle de lecture restante : stock_movements.zz_extra_select")" "1" "règle supplémentaire : le garde-fou l'attrape"
ok "$(HIST r184fail)|$(POL r184fail)|$(FUN r184fail)" "|$POLb|0" "→ 184 annulée entière (absente de l'historique, règles inchangées, aucune fonction)"

for d in r184 r184fail; do P -d postgres -c "drop database if exists $d" >/dev/null; done
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
