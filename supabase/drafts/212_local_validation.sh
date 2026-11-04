#!/bin/bash
# Validation LOCALE de 212 (changements de formule) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : existant inchangé (paiements « now », crédit 0), changement programmé complet ou absent, crédit et manière
# d'appliquer contrôlés, statut « refunded » avec motif obligatoire, écriture refusée aux comptes connectés,
# ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/212_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r212
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '([a-z_]+_check|permission denied|réservée au serveur)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
E=e0000000-0000-0000-0000-000000000001

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE entities (id uuid primary key, name text, plan text, plan_expires_at timestamptz);
CREATE TABLE subscriptions (id serial primary key, billing_period text, CONSTRAINT subscriptions_billing_period_check CHECK (billing_period IN ('monthly', 'quarterly', 'annual')));
CREATE TABLE payment_intents (id serial primary key, reference text UNIQUE, plan text, amount numeric CHECK (amount > 0), amount_due numeric,
  status text NOT NULL DEFAULT 'pending', CONSTRAINT payment_intents_status_check CHECK (status IN ('pending', 'paid', 'review', 'failed')),
  CONSTRAINT payment_intents_check CHECK (amount_due > 0 AND amount_due <= amount));
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_role text;
BEGIN
  v_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END $$;
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT request_is_restricted() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER trg_entities_guard BEFORE INSERT OR UPDATE OR DELETE ON entities FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns();
CREATE TRIGGER trg_payment_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_intents FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns();
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000001', 'SOFAR', 'business', now() + interval '20 days');
INSERT INTO payment_intents (reference, plan, amount, amount_due, status) VALUES ('SS-ancien', 'pro', 10000, 10000, 'paid');
GRANT ALL ON entities, payment_intents TO authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/212_plan_changes.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "exécution n° $i"; done

echo "── 2. Existant inchangé"
ok "$(Q "SELECT schedule || '/' || prorata_credit || '/' || coalesce(prev_plan, 'aucun') || '/' || status FROM payment_intents WHERE reference = 'SS-ancien'")" "now/0/aucun/paid" "ancien paiement : appliqué tout de suite, sans crédit"
ok "$(Q "SELECT coalesce(next_plan, 'aucun') FROM entities")" "aucun" "aucun changement programmé"

echo "── 3. Changement programmé (descente)"
ok "$(Q "UPDATE entities SET next_plan = 'pro', next_plan_from = plan_expires_at, next_plan_until = plan_expires_at + interval '31 days', next_billing_period = 'monthly', next_addon_seats = 1, next_addon_shops = 0 RETURNING next_plan")" "pro" "descente vers Pro à la fin de la période"
ok "$(ERR "UPDATE entities SET next_plan_until = next_plan_from")" "entities_next_plan_check" "période vide refusée"
ok "$(ERR "UPDATE entities SET next_plan = 'trial'")" "entities_next_plan_check" "essai programmé refusé"
ok "$(ERR "UPDATE entities SET next_plan = NULL")" "entities_next_plan_check" "changement à moitié effacé refusé"
ok "$(ERR "UPDATE entities SET next_addon_shops = 3")" "entities_next_plan_check" "options au-delà du plafond refusées"
ok "$(Q "UPDATE entities SET next_plan = NULL, next_plan_from = NULL, next_plan_until = NULL, next_billing_period = NULL, next_addon_seats = NULL, next_addon_shops = NULL RETURNING coalesce(next_plan, 'aucun')")" "aucun" "changement annulé proprement"

echo "── 4. Paiements"
ok "$(Q "INSERT INTO payment_intents (reference, plan, amount, amount_due, prorata_credit, schedule, prev_plan, prev_plan_expires_at) VALUES ('SS-montee', 'pro', 10000, 7500, 2500, 'now', 'starter', now() + interval '15 days') RETURNING amount_due || '/' || prorata_credit")" "7500/2500" "montée : 10 000 moins 2 500 de crédit"
ok "$(ERR "INSERT INTO payment_intents (reference, plan, amount, amount_due, prorata_credit) VALUES ('SS-x1', 'pro', 10000, 10000, -1)")" "payment_intents_changes_check" "crédit négatif refusé"
ok "$(ERR "INSERT INTO payment_intents (reference, plan, amount, amount_due, schedule) VALUES ('SS-x2', 'pro', 10000, 10000, 'demain')")" "payment_intents_changes_check" "manière d'appliquer inconnue refusée"
ok "$(Q "INSERT INTO payment_intents (reference, plan, amount, amount_due, schedule) VALUES ('SS-x3', 'pro', 10000, 10000, 'stack') RETURNING schedule")" "stack" "renouvellement anticipé accepté"
ok "$(ERR "UPDATE payment_intents SET status = 'refunded', refunded_at = now() WHERE reference = 'SS-montee'")" "payment_intents_changes_check" "remboursement sans motif refusé"
ok "$(Q "UPDATE payment_intents SET status = 'refunded', refunded_at = now(), refund_reason = 'Double paiement' WHERE reference = 'SS-montee' RETURNING status")" "refunded" "remboursement avec motif accepté"
ok "$(ERR "UPDATE payment_intents SET status = 'annule' WHERE reference = 'SS-x3'")" "payment_intents_status_check" "statut inconnu refusé"

echo "── 4b. Abonnements de 6 mois"
ok "$(Q "INSERT INTO subscriptions (billing_period) VALUES ('semiannual') RETURNING billing_period")" "semiannual" "abonnement de 6 mois enregistré (refusé avant la 212)"
ok "$(ERR "INSERT INTO subscriptions (billing_period) VALUES ('hebdo')")" "subscriptions_billing_period_check" "durée inconnue toujours refusée"

echo "── 5. Accès"
JWT="SET request.jwt.claims = '{\"role\":\"authenticated\"}';"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT UPDATE entities SET next_plan = 'pro', next_plan_from = now(), next_plan_until = now() + interval '1 day'" 2>&1 | grep -oE 'réservée au serveur' | head -1)" "réservée au serveur" "compte connecté : pas de changement programmé direct"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT UPDATE payment_intents SET prorata_credit = 9999" 2>&1 | grep -oE 'réservée au serveur' | head -1)" "réservée au serveur" "compte connecté : pas de crédit modifiable"

echo "── 6. Retour arrière"
P -d $DB -c "UPDATE payment_intents SET status = 'paid', refunded_at = NULL, refund_reason = NULL WHERE status = 'refunded'" >/dev/null
P -d $DB -f supabase/rollbacks/212_plan_changes_rollback.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "retour arrière exécuté (sans paiement remboursé)"
ok "$(Q "SELECT count(*) FROM information_schema.columns WHERE column_name IN ('next_plan','prorata_credit','schedule','prev_plan','refunded_at')")" "0" "colonnes retirées"
P -d $DB -f supabase/migrations/212_plan_changes.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
