#!/bin/bash
# Validation LOCALE de 209 (historique par formule dans la base) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie, en compte connecté (authenticated, RLS) : durée par formule (Starter 3 mois, Pro 1 an, Business / interne /
# anciennes conditions sans limite), exceptions (vente encore due, vente payée dans la période, dépense modèle),
# paiements et lignes qui suivent la vente, caisse du jour avec remboursement d'un vieux crédit, droits du rôle
# inchangés (caissier : ses ventes seulement), clé de service non concernée, accord avec lib/saas/plan-features,
# ré-exécution, retour arrière, temps de lecture sur 30 000 ventes.
# Usage (racine du dépôt) : bash supabase/drafts/209_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r209
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
OWNER=10000000-0000-0000-0000-000000000001; CASHIER=10000000-0000-0000-0000-000000000003
# Boutiques : S Starter, R Pro, B Business, I interne (Starter), L Starter avec anciennes conditions en cours,
# X Starter avec anciennes conditions terminées, T essai, N sans entreprise
S=a0000000-0000-0000-0000-00000000000a; PR=a0000000-0000-0000-0000-00000000000b; B=a0000000-0000-0000-0000-00000000000c
I=a0000000-0000-0000-0000-00000000000d; L=a0000000-0000-0000-0000-00000000000e; X=a0000000-0000-0000-0000-00000000000f
T=a0000000-0000-0000-0000-000000000010; N=a0000000-0000-0000-0000-000000000011
AS_OWNER="SET ROLE authenticated; SET request.jwt.claim.sub = '$OWNER';"
AS_CASHIER="SET ROLE authenticated; SET request.jwt.claim.sub = '$CASHIER';"
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
QO() { P -d $DB -c "$AS_OWNER $1" 2>&1 | tail -1; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL >/dev/null || { echo "schéma local impossible"; exit 2; }
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
CREATE TABLE public.entities (id uuid PRIMARY KEY, plan text, is_internal boolean DEFAULT false, legacy_terms jsonb);
CREATE TABLE public.shops (id uuid PRIMARY KEY, entity_id uuid);
CREATE TABLE public.shop_members (shop_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, cashier_id uuid, created_at timestamptz, balance numeric DEFAULT 0, label text);
CREATE TABLE public.payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid, paid_at timestamptz, amount numeric);
CREATE TABLE public.sale_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid);
CREATE TABLE public.expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, date date, is_recurring boolean DEFAULT false, label text);
CREATE INDEX ON public.sales (shop_id, created_at); CREATE INDEX ON public.payments (sale_id);
-- Droits du rôle : version simplifiée (le droit lui-même n'est pas l'objet de la 209) ; le caissier n'a pas l'historique
CREATE FUNCTION public.shop_ids_with_any_feature(p_features text[], p_roles text[] DEFAULT NULL) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS \$f\$
  SELECT shop_id FROM public.shop_members WHERE user_id = auth.uid() AND is_active AND (p_roles IS NULL OR role = ANY (p_roles))
\$f\$;
CREATE FUNCTION public.shop_ids_with_feature(p_feature text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS \$f\$
  SELECT shop_id FROM public.shop_members WHERE user_id = auth.uid() AND is_active AND role IN ('owner', 'manager')
\$f\$;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY; ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY; ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
-- Règles d'avant, comme en production (pg_policies du 3 nov. 2026)
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer'])));
CREATE POLICY sales_read_own ON public.sales FOR SELECT TO authenticated
  USING (cashier_id = auth.uid() AND shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['new_sale', 'sales_history', 'caisse'])));
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = payments.sale_id AND s.shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse']))));
CREATE POLICY sale_items_read ON public.sale_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id AND s.shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'new_sale']))));
CREATE POLICY expenses_feature_select ON public.expenses FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_feature('expenses')));
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, service_role;

INSERT INTO public.entities VALUES
  ('e0000000-0000-0000-0000-00000000000a', 'starter', false, NULL),
  ('e0000000-0000-0000-0000-00000000000b', 'pro', false, NULL),
  ('e0000000-0000-0000-0000-00000000000c', 'business', false, NULL),
  ('e0000000-0000-0000-0000-00000000000d', 'starter', true, NULL),
  ('e0000000-0000-0000-0000-00000000000e', 'starter', false, jsonb_build_object('plan', 'starter', 'shops', 3, 'team_members', 10, 'limits_until', (now() + interval '60 days')::text)),
  ('e0000000-0000-0000-0000-00000000000f', 'starter', false, jsonb_build_object('plan', 'starter', 'shops', 3, 'team_members', 10, 'limits_until', (now() - interval '1 day')::text)),
  ('e0000000-0000-0000-0000-000000000010', 'trial', false, NULL);
INSERT INTO public.shops VALUES ('$S', 'e0000000-0000-0000-0000-00000000000a'), ('$PR', 'e0000000-0000-0000-0000-00000000000b'),
  ('$B', 'e0000000-0000-0000-0000-00000000000c'), ('$I', 'e0000000-0000-0000-0000-00000000000d'), ('$L', 'e0000000-0000-0000-0000-00000000000e'),
  ('$X', 'e0000000-0000-0000-0000-00000000000f'), ('$T', 'e0000000-0000-0000-0000-000000000010'), ('$N', NULL);
INSERT INTO public.shop_members SELECT id, '$OWNER', 'owner', true FROM public.shops;
INSERT INTO public.shop_members VALUES ('$S', '$CASHIER', 'cashier', true);
-- Ventes de chaque boutique : 10 j, 100 j, 400 j (soldées) ; dans S : 100 j encore due, 100 j remboursée aujourd'hui
INSERT INTO public.sales (shop_id, cashier_id, created_at, label)
  SELECT s.id, '$OWNER', now() - (d || ' days')::interval, 'j' || d FROM public.shops s, unnest(ARRAY[10, 100, 400]) d;
INSERT INTO public.sales (shop_id, cashier_id, created_at, balance, label) VALUES
  ('$S', '$OWNER', now() - interval '100 days', 5000, 'due'),
  ('$S', '$OWNER', now() - interval '100 days', 0, 'repaid_today'),
  ('$S', '$CASHIER', now() - interval '5 days', 0, 'cashier_recent'),
  ('$S', '$CASHIER', now() - interval '100 days', 0, 'cashier_old');
INSERT INTO public.payments (sale_id, paid_at, amount) SELECT id, created_at, 1 FROM public.sales;
INSERT INTO public.payments (sale_id, paid_at, amount) SELECT id, now(), 2000 FROM public.sales WHERE label = 'repaid_today';
INSERT INTO public.sale_items (sale_id) SELECT id FROM public.sales;
INSERT INTO public.expenses (shop_id, date, label)
  SELECT s.id, (now() - (d || ' days')::interval)::date, 'j' || d FROM public.shops s, unnest(ARRAY[10, 100, 400]) d;
INSERT INTO public.expenses (shop_id, date, is_recurring, label) VALUES ('$S', (now() - interval '400 days')::date, true, 'modele');
SQL

labels() { QO "SELECT coalesce(string_agg(label, ',' ORDER BY label), 'aucune') FROM public.sales WHERE shop_id = '$1'"; }
exp_labels() { QO "SELECT coalesce(string_agg(label, ',' ORDER BY label), 'aucune') FROM public.expenses WHERE shop_id = '$1'"; }

echo "── 0. Avant la 209 : tout est lisible"
ok "$(labels $S)" "cashier_old,cashier_recent,due,j10,j100,j400,repaid_today" "Starter : toutes les ventes"

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/209_history_by_plan.sql >/dev/null 2>&1 && R=ok || R=ko; ok "$R" "ok" "exécution n° $i"; done

echo "── 2. Durée par formule (ventes)"
ok "$(labels $S)" "cashier_recent,due,j10,repaid_today" "Starter : 10 j, encore due, remboursée aujourd'hui ; 100 j et 400 j soldées cachées"
ok "$(labels $PR)" "j10,j100" "Pro : 10 j et 100 j ; 400 j cachée"
ok "$(labels $T)" "j10,j100" "essai : comme Pro"
ok "$(labels $N)" "j10,j100" "boutique sans entreprise : comme l'essai"
ok "$(labels $B)" "j10,j100,j400" "Business : sans limite"
ok "$(labels $I)" "j10,j100,j400" "compte interne : sans limite"
ok "$(labels $L)" "j10,j100,j400" "Starter avec anciennes conditions en cours : sans limite"
ok "$(labels $X)" "j10" "Starter, anciennes conditions terminées : 3 mois"

echo "── 3. Paiements, lignes, caisse du jour"
ok "$(QO "SELECT count(*) FROM public.payments p JOIN public.sales s ON s.id = p.sale_id WHERE s.shop_id = '$S'")" "5" "paiements Starter : ceux des ventes lisibles (4 ventes + remboursement du jour)"
ok "$(QO "SELECT count(*) FROM public.payments WHERE paid_at >= date_trunc('day', now())")" "1" "caisse du jour : le remboursement d'un vieux crédit est là"
ok "$(QO "SELECT count(*) FROM public.payments WHERE paid_at >= date_trunc('day', now()) AND EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_id)")" "1" "caisse du jour : jointure avec la vente (comme sales!inner)"
ok "$(QO "SELECT count(*) FROM public.sale_items i JOIN public.sales s ON s.id = i.sale_id WHERE s.shop_id = '$PR'")" "2" "lignes Pro : celles des 2 ventes lisibles"

echo "── 4. Droits du rôle inchangés"
ok "$(P -d $DB -c "$AS_CASHIER SELECT coalesce(string_agg(label, ',' ORDER BY label), 'aucune') FROM public.sales" 2>&1 | tail -1)" "cashier_recent" "caissier Starter : SES ventes récentes seulement (pas l'ancienne)"
ok "$(Q "SET ROLE service_role; SELECT count(*) FROM public.sales WHERE shop_id = '$S'")" "7" "clé de service (serveur) : non concernée"

echo "── 5. Dépenses"
ok "$(exp_labels $S)" "j10,modele" "Starter : 10 j et le modèle récurrent ; 100 j et 400 j cachées"
ok "$(exp_labels $PR)" "j10,j100" "Pro : 400 j cachée"
ok "$(exp_labels $B)" "j10,j100,j400" "Business : sans limite"

echo "── 6. Même règle que lib/saas/plan-features (92 + 1 / 366 + 1 jours)"
ok "$(Q "SELECT round(extract(epoch FROM now() - public.shop_history_floor('$S')) / 86400)")" "93" "Starter : now() - 93 jours"
ok "$(Q "SELECT round(extract(epoch FROM now() - public.shop_history_floor('$PR')) / 86400)")" "367" "Pro : now() - 367 jours"
ok "$(Q "SELECT coalesce(public.shop_history_floor('$B')::text, 'aucune')")" "aucune" "Business : aucune limite"
TS=$(grep -oE "REPORT_FREE_DAYS = [0-9]+|PRO_HISTORY_DAYS = [0-9]+" lib/saas/plan-features.ts | grep -oE "[0-9]+" | tr '\n' ' ')
ok "$TS" "92 366 " "constantes du serveur : 92 et 366 jours (+1 de marge)"
P -d $DB -c "UPDATE public.entities SET legacy_terms = '{\"plan\": \"starter\", \"limits_until\": \"pas une date\"}' WHERE id = 'e0000000-0000-0000-0000-00000000000e'" >/dev/null
ok "$(labels $L)" "j10" "anciennes conditions illisibles : ignorées, jamais une erreur de lecture"

echo "── 7. Accès"
ok "$(P -d $DB -c "SET ROLE anon; SELECT public.shop_history_floor('$S')" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "anonyme : fonctions refusées"

echo "── 8. Temps de lecture (30 000 ventes Starter, compte connecté)"
P -d $DB -c "INSERT INTO public.sales (shop_id, cashier_id, created_at, label) SELECT '$S', '$OWNER', now() - (random() * 500 || ' days')::interval, 'x' FROM generate_series(1, 30000); ANALYZE;" >/dev/null
MS=$(P -d $DB -c "$AS_OWNER EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM public.sales WHERE shop_id = '$S' AND created_at >= now() - interval '30 days' ORDER BY created_at DESC LIMIT 1000" 2>&1 | grep -oE '"Execution Time": [0-9.]+' | grep -oE '[0-9.]+$')
ok "$(awk -v m="$MS" 'BEGIN { print (m < 300) ? "rapide" : "lent " m " ms" }')" "rapide" "liste du mois (≈ 1 800 ventes) : ${MS} ms"
MS2=$(P -d $DB -c "$AS_OWNER EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(*) FROM public.sales WHERE shop_id = '$S'" 2>&1 | grep -oE '"Execution Time": [0-9.]+' | grep -oE '[0-9.]+$')
ok "$(awk -v m="$MS2" 'BEGIN { print (m < 3000) ? "acceptable" : "lent " m " ms" }')" "acceptable" "compte de TOUTES les ventes (30 000, pire cas) : ${MS2} ms"

echo "── 9. Retour arrière"
P -d $DB -f supabase/rollbacks/209_history_by_plan_rollback.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "retour arrière exécuté"
ok "$(QO "SELECT count(*) FROM public.sales WHERE shop_id = '$X'")" "3" "après retour arrière : tout est relisible"
P -d $DB -f supabase/migrations/209_history_by_plan.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
