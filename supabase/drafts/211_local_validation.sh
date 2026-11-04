#!/bin/bash
# Validation LOCALE de 211 (offre sur mesure) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : demande et devis (devis complet obligatoire dès l'envoi), lecture par le propriétaire seul, aucune écriture
# par un compte connecté, limites sur mesure de l'entreprise, paiement « devis » (quote_id obligatoire), contrainte des
# options inchangée, ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/211_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r211
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '([a-z_]+_check|permission denied|réservée au serveur|duplicate key)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
E=e0000000-0000-0000-0000-000000000001; E2=e0000000-0000-0000-0000-000000000002
OWNER=10000000-0000-0000-0000-000000000001; OTHER=10000000-0000-0000-0000-000000000002
S=a0000000-0000-0000-0000-000000000001
TOK=tok_abcdefghijklmnopqrstuvwxyz0123
AS() { echo "SET ROLE authenticated; SET request.jwt.claims = '{\"role\":\"authenticated\",\"sub\":\"$1\"}';"; }
PI="INSERT INTO payment_intents (reference, gateway, shop_id, plan, billing_period, currency, amount, amount_due"
QUOTED="status, req_shops, req_seats, req_period, currency, monthly_price, billing_period, period_total, limit_shops, limit_seats, valid_until, token"

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL >/dev/null || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END \$\$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid \$f\$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE entities (id uuid primary key, name text, plan text, owner_user_id uuid);
CREATE TABLE shops (id uuid primary key, entity_id uuid);
CREATE TABLE payment_intents (id serial primary key, reference text UNIQUE, gateway text, shop_id uuid, plan text, billing_period text, currency text,
  amount numeric, amount_due numeric, status text DEFAULT 'pending', kind text NOT NULL DEFAULT 'plan', addon_seats int NOT NULL DEFAULT 0,
  addon_shops int NOT NULL DEFAULT 0, period_end timestamptz);
-- Contrainte des options de la 210, comme en production
ALTER TABLE payment_intents ADD CONSTRAINT payment_intents_addons_check CHECK (kind IN ('plan', 'addon') AND addon_seats BETWEEN 0 AND 20
  AND addon_shops BETWEEN 0 AND 2 AND (kind = 'plan' OR (addon_seats + addon_shops > 0 AND period_end IS NOT NULL)));
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS \$f\$ SELECT false \$f\$;
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean LANGUAGE plpgsql STABLE AS \$f\$
DECLARE v_role text;
BEGIN
  v_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END \$f\$;
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger LANGUAGE plpgsql AS \$f\$
BEGIN
  IF NOT request_is_restricted() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END \$f\$;
INSERT INTO entities VALUES ('$E', 'Groupe Test', 'business', '$OWNER'), ('$E2', 'Autre', 'pro', '$OTHER');
INSERT INTO shops VALUES ('$S', '$E');
INSERT INTO payment_intents (reference, gateway, shop_id, plan, billing_period, currency, amount, amount_due, kind, addon_seats, period_end)
  VALUES ('SS-option-ancienne', 'flutterwave', '$S', 'pro', 'monthly', 'XOF', 900, 900, 'addon', 1, now());
GRANT SELECT ON entities TO authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/211_custom_quotes.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "exécution n° $i"; done

echo "── 2. Demande et devis"
ok "$(Q "INSERT INTO custom_quotes (entity_id, shop_id, requested_by, req_shops, req_seats, req_period, req_needs) VALUES ('$E', '$S', '$OWNER', 5, 12, 'annual', 'Deux depots') RETURNING status")" "requested" "demande enregistrée (5 boutiques, 12 employés, 1 an)"
ok "$(ERR "UPDATE custom_quotes SET status = 'quoted', monthly_price = 29000")" "custom_quotes_check" "devis envoyé incomplet (sans total, limites, validité, lien) refusé"
ok "$(Q "UPDATE custom_quotes SET status = 'quoted', currency = 'XOF', monthly_price = 29000, billing_period = 'annual', period_total = 290000, limit_shops = 5, limit_seats = 12, valid_until = now() + interval '15 days', token = '$TOK' RETURNING status")" "quoted" "devis complet accepté"
ok "$(ERR "INSERT INTO custom_quotes ($QUOTED, entity_id) VALUES ('quoted', 4, 1, 'monthly', 'XOF', 1, 'monthly', 1, 4, 1, now(), '$TOK', '$E')")" "duplicate key" "lien de paiement unique"
ok "$(ERR "INSERT INTO custom_quotes (entity_id, req_shops, req_seats, req_period, status) VALUES ('$E', 5, 1, 'monthly', 'gratuit')")" "custom_quotes_check" "état inconnu refusé"
ok "$(ERR "INSERT INTO custom_quotes (entity_id, req_shops, req_seats, req_period) VALUES ('$E', 5, 1, 'quarterly')")" "custom_quotes_check" "durée non proposée refusée"
ok "$(ERR "INSERT INTO custom_quotes (entity_id, req_shops, req_seats, req_period) VALUES ('$E', 0, 1, 'monthly')")" "custom_quotes_check" "0 boutique refusé"

echo "── 3. Accès"
ok "$(P -d $DB -c "$(AS $OWNER) SELECT count(*) FROM custom_quotes" 2>&1 | tail -1)" "1" "propriétaire : voit son devis"
ok "$(P -d $DB -c "$(AS $OTHER) SELECT count(*) FROM custom_quotes" 2>&1 | tail -1)" "0" "autre compte : ne voit rien"
ok "$(P -d $DB -c "$(AS $OWNER) UPDATE custom_quotes SET monthly_price = 1" 2>&1 | grep -oE 'permission denied|réservée au serveur' | head -1)" "permission denied" "propriétaire : ne peut pas changer le prix"
ok "$(P -d $DB -c "$(AS $OWNER) INSERT INTO custom_quotes (entity_id, req_shops, req_seats, req_period) VALUES ('$E', 9, 9, 'monthly')" 2>&1 | grep -oE 'permission denied|réservée au serveur' | head -1)" "permission denied" "propriétaire : pas d'écriture directe (le serveur seul)"
ok "$(P -d $DB -c "SET ROLE anon; SELECT count(*) FROM custom_quotes" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "anonyme : aucun accès"

echo "── 4. Limites sur mesure et paiement « devis »"
QID=$(Q "SELECT id FROM custom_quotes WHERE token = '$TOK'")
ok "$(Q "UPDATE entities SET custom_shops = 5, custom_seats = 12, custom_quote_id = '$QID' WHERE id = '$E' RETURNING custom_shops || '/' || custom_seats")" "5/12" "limites sur mesure posées"
ok "$(ERR "UPDATE entities SET custom_shops = 0 WHERE id = '$E'")" "entities_custom_limits_check" "0 boutique sur mesure refusé"
ok "$(Q "$PI, kind, quote_id) VALUES ('SS-devis-1', 'flutterwave', '$S', 'business', 'annual', 'XOF', 290000, 290000, 'custom', '$QID') RETURNING kind")" "custom" "paiement du devis préparé"
ok "$(ERR "$PI, kind) VALUES ('SS-devis-2', 'flutterwave', '$S', 'business', 'annual', 'XOF', 290000, 290000, 'custom')")" "payment_intents_addons_check" "paiement « devis » sans devis refusé"
ok "$(ERR "$PI, kind, addon_seats) VALUES ('SS-option-2', 'flutterwave', '$S', 'pro', 'monthly', 'XOF', 900, 900, 'addon', 1)")" "payment_intents_addons_check" "option sans fin de période toujours refusée (règle de la 210 gardée)"
ok "$(Q "SELECT count(*) FROM payment_intents WHERE reference = 'SS-option-ancienne'")" "1" "paiement d'option existant intact"

echo "── 5. Retour arrière"
P -d $DB -c "DELETE FROM payment_intents WHERE kind = 'custom'" >/dev/null
P -d $DB -f supabase/rollbacks/211_custom_quotes_rollback.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "retour arrière exécuté (sans paiement « devis »)"
ok "$(Q "SELECT (to_regclass('public.custom_quotes') IS NULL)::text || '/' || count(*) FROM information_schema.columns WHERE column_name IN ('custom_shops','custom_seats','custom_quote_id','quote_id')")" "true/0" "table et colonnes retirées"
P -d $DB -f supabase/migrations/211_custom_quotes.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
