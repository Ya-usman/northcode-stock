#!/bin/bash
# Validation LOCALE de 218 (totaux de période de l'Historique) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : création, relance sans erreur, totaux exacts (nombre, chiffre d'affaires, reste dû sans les ventes
# annulées, encaissé sans paiements annulés ni abandons), plus de 1000 ventes, chaque filtre de l'écran, règle « mes
# ventes » (vendeur seul, puis mélange vendeur / responsable), règles d'accès respectées (SECURITY INVOKER : une personne
# hors de la boutique obtient 0), anonyme refusé, retour arrière puis réapplication.
# Usage (racine du dépôt) : bash supabase/drafts/218_local_validation.sh   (KEEP=1 garde la base)
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r218
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(permission denied|droit refusé)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

# Personnes et boutiques
OWNER=00000000-0000-0000-0000-0000000000a1; CASHIER=00000000-0000-0000-0000-0000000000b2; STRANGER=00000000-0000-0000-0000-0000000000c3
S1=10000000-0000-0000-0000-000000000001; S2=10000000-0000-0000-0000-000000000002

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL >/dev/null || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Comme sur Supabase : droits par défaut accordés aux rôles de l'API (fonctions comprises)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Membres (simplifié) : propriétaire dans S1 et S2, vendeur dans S1 seulement
CREATE TABLE members (shop_id uuid, user_id uuid);
INSERT INTO members VALUES ('$S1', '$OWNER'), ('$S2', '$OWNER'), ('$S1', '$CASHIER');
GRANT SELECT ON members TO authenticated;
CREATE TABLE sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, created_at timestamptz, total numeric,
  amount_paid numeric, balance numeric GENERATED ALWAYS AS (total - amount_paid) STORED, sale_status text,
  payment_method text, payment_status text, cashier_id uuid);
CREATE TABLE payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid REFERENCES sales(id), amount numeric,
  paid_at timestamptz, method text, received_by uuid, is_cancelled boolean DEFAULT false, is_write_off boolean DEFAULT false);
ALTER TABLE sales ENABLE ROW LEVEL SECURITY; ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- Règles d'accès simulées : membre de la boutique ; le vendeur ne voit que SES ventes
CREATE POLICY sales_read ON sales FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM members m WHERE m.shop_id = sales.shop_id AND m.user_id = auth.uid())
  AND (auth.uid() <> '$CASHIER' OR cashier_id = auth.uid()));
CREATE POLICY payments_read ON payments FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id));
-- Jeu de données : S1 = 2 400 ventes actives à 100 (1 200 du propriétaire, 1 200 du vendeur), payées 60 chacune
--                  + 10 ventes annulées à 50 (non payées) ; S2 = 5 ventes actives à 1 000, payées en entier, Mobile Money
INSERT INTO sales (shop_id, created_at, total, amount_paid, sale_status, payment_method, payment_status, cashier_id)
SELECT '$S1', timestamptz '2026-03-01' + (g || ' seconds')::interval, 100, 60, 'active', 'cash', 'partial',
       CASE WHEN g % 2 = 0 THEN '$OWNER'::uuid ELSE '$CASHIER'::uuid END FROM generate_series(1, 2400) g;
INSERT INTO sales (shop_id, created_at, total, amount_paid, sale_status, payment_method, payment_status, cashier_id)
SELECT '$S1', timestamptz '2026-03-02', 50, 0, 'cancelled', 'cash', 'unpaid', '$OWNER' FROM generate_series(1, 10);
INSERT INTO sales (shop_id, created_at, total, amount_paid, sale_status, payment_method, payment_status, cashier_id)
SELECT '$S2', timestamptz '2026-03-03', 1000, 1000, 'active', 'mtn_momo', 'paid', '$OWNER' FROM generate_series(1, 5);
-- Paiements : un par vente payée, encaissé par le vendeur de la vente ; + 1 paiement annulé et 1 abandon de créance
INSERT INTO payments (sale_id, amount, paid_at, method, received_by)
SELECT id, amount_paid, created_at, payment_method, cashier_id FROM sales WHERE amount_paid > 0;
INSERT INTO payments (sale_id, amount, paid_at, method, received_by, is_cancelled)
SELECT id, 999, created_at, 'cash', cashier_id, true FROM sales WHERE shop_id = '$S2' LIMIT 1;
INSERT INTO payments (sale_id, amount, paid_at, method, received_by, is_write_off)
SELECT id, 40, created_at, 'cash', cashier_id, true FROM sales WHERE shop_id = '$S1' AND sale_status = 'active' LIMIT 1;
SQL

apply() { P -d $DB -c "BEGIN" -f supabase/migrations/218_sales_period_totals.sql -c "COMMIT" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' || echo appliquée; }
ok "$(apply)" "appliquée" "218 appliquée"
ok "$(apply)" "appliquée" "relance sans erreur (idempotente)"

AS() { echo "SET ROLE authenticated; SET request.jwt.claim.sub = '$1';"; }
PERIOD="'2026-01-01'::timestamptz, '2026-12-31'::timestamptz"
T() { Q "$(AS "$1") SELECT sale_count || '|' || revenue::int || '|' || open_balance::int FROM sales_period_totals($2)"; }
C() { Q "$(AS "$1") SELECT payments_period_collected($2)::int"; }

# Propriétaire, deux boutiques, toutes ventes (actives + annulées)
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled']")" "2415|245500|96000" \
   "propriétaire : 2 415 ventes, CA 245 500, reste dû 96 000 (annulées exclues du reste dû) — au-delà de 1000"
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active']")" "2405|245000|96000" "filtre : ventes actives seulement"
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['cancelled']")" "10|500|0" "filtre : ventes annulées seulement (reste dû 0)"
ok "$(T $OWNER "ARRAY['$S2']::uuid[], $PERIOD, ARRAY['active','cancelled'], ARRAY['mtn_momo','orange_money']")" "5|5000|0" "filtre : moyen de paiement (liste Mobile Money)"
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled'], NULL, 'paid'")" "5|5000|0" "filtre : statut du paiement"
ok "$(T $OWNER "ARRAY['$S1']::uuid[], '2026-03-02'::timestamptz, '2026-03-02 23:59:59'::timestamptz, ARRAY['active','cancelled']")" "10|500|0" "filtre : période (bornes incluses)"
ok "$(C $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD")" "149000" "encaissé : 2 400 × 60 + 5 × 1 000, sans paiement annulé ni abandon de créance"
ok "$(C $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['cancelled']")" "0" "encaissé : filtre statut de la vente"
ok "$(C $OWNER "ARRAY['$S2']::uuid[], $PERIOD, NULL, ARRAY['mtn_momo']")" "5000" "encaissé : filtre moyen de paiement"

# Vendeur : seulement ses ventes et ses encaissements (règle « mes ventes » ET règle d'accès)
ok "$(T $CASHIER "ARRAY['$S1']::uuid[], $PERIOD, ARRAY['active','cancelled'], NULL, NULL, ARRAY['$S1']::uuid[]")" "1200|120000|48000" "vendeur : ses 1 200 ventes seulement"
ok "$(C $CASHIER "ARRAY['$S1']::uuid[], $PERIOD, NULL, NULL, ARRAY['$S1']::uuid[]")" "72000" "vendeur : ses encaissements seulement"
ok "$(T $CASHIER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled'], NULL, NULL, ARRAY['$S1']::uuid[]")" "1200|120000|48000" "vendeur : une boutique où il n'est pas membre n'ajoute rien (règles d'accès)"
# Mélange : le propriétaire marqué « vendeur » dans S1 seulement → ses ventes de S1 + toute la boutique S2
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled'], NULL, NULL, ARRAY['$S1']::uuid[]")" "1215|125500|48000" "mélange : mes ventes dans S1 + toutes celles de S2"
ok "$(C $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, NULL, NULL, ARRAY['$S1']::uuid[]")" "77000" "mélange : mes encaissements dans S1 + tous ceux de S2"

# Personne hors des boutiques : rien (SECURITY INVOKER, règles d'accès appliquées)
ok "$(T $STRANGER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled']")" "0|0|0" "personne hors des boutiques : 0 vente"
ok "$(C $STRANGER "ARRAY['$S1','$S2']::uuid[], $PERIOD")" "0" "personne hors des boutiques : 0 encaissé"
ok "$(Q "SELECT prosecdef FROM pg_proc WHERE proname = 'sales_period_totals'")" "f" "sales_period_totals en SECURITY INVOKER"
ok "$(Q "SELECT prosecdef FROM pg_proc WHERE proname = 'payments_period_collected'")" "f" "payments_period_collected en SECURITY INVOKER"

# Anonyme : appel refusé (malgré les droits par défaut du schéma)
ok "$(ERR "SET ROLE anon; SELECT * FROM sales_period_totals(ARRAY['$S1']::uuid[], $PERIOD, ARRAY['active'])")" "permission denied" "anonyme : totaux refusés"
ok "$(ERR "SET ROLE anon; SELECT payments_period_collected(ARRAY['$S1']::uuid[], $PERIOD)")" "permission denied" "anonyme : encaissé refusé"

# Retour arrière puis réapplication
ok "$(P -d $DB -c "BEGIN" -f supabase/rollbacks/218_sales_period_totals_rollback.sql -c "COMMIT" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' || echo retirée)" "retirée" "retour arrière"
ok "$(Q "SELECT count(*) FROM pg_proc WHERE proname IN ('sales_period_totals','payments_period_collected')")" "0" "fonctions retirées"
ok "$(Q "SELECT count(*) FROM sales")" "2415" "données intactes après le retour arrière"
ok "$(apply)" "appliquée" "réapplication après retour arrière"
ok "$(T $OWNER "ARRAY['$S1','$S2']::uuid[], $PERIOD, ARRAY['active','cancelled']")" "2415|245500|96000" "mêmes totaux après réapplication"

echo; echo "$pass réussis, $fail échec(s)"
[ "${KEEP:-0}" = 1 ] || P -d postgres -c "drop database if exists $DB" >/dev/null
[ $fail -eq 0 ]
