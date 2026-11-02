#!/bin/bash
# Validation LOCALE de 204 (paiements préparés par le serveur) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : création ré-exécutable, contraintes (montants, devise, formule, durée, référence unique), écriture refusée
# aux comptes connectés et anonymes (verrou 154), lecture réservée au super administrateur, règlement unique d'une
# ligne (mise à jour conditionnelle), retour arrière propre.
# Usage (racine du dépôt) : bash supabase/drafts/204_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r204
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(payment_intents_([a-z_]+_)?check|duplicate key|réservée au serveur|permission denied|violates not-null)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE TABLE entities (id uuid primary key);
CREATE TABLE shops (id uuid primary key);
-- Super administrateur simulé : réglage de session
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.super', true), '') = 'oui' $$;
-- Fonctions de la migration 154 (copie fidèle)
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END $$;
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c text; v_new jsonb; v_old jsonb;
BEGIN
  IF NOT request_is_restricted() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'UPDATE' OR '*' = ANY (TG_ARGV) THEN
    RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  v_new := to_jsonb(NEW); v_old := to_jsonb(OLD);
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (v_new -> c) IS DISTINCT FROM (v_old -> c) THEN
      RAISE EXCEPTION 'Colonne %.% modifiable uniquement par le serveur', TG_TABLE_NAME, c USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000001');
INSERT INTO shops VALUES ('a0000000-0000-0000-0000-000000000001');
-- Droits par défaut de Supabase : tout est accordé aux rôles des requêtes, la RLS et les verrous font le tri
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/204_payment_intents.sql >/dev/null 2>&1 && R=ok || R=ko; ok "$R" "ok" "exécution n° $i"; done

ROW="'SS-test-0001', 'flutterwave', 'e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'pro', 'semiannual', 'XOF', 55000, 0, 55000"
COLS="reference, gateway, entity_id, shop_id, plan, billing_period, currency, amount, credit_applied, amount_due"
echo "── 2. Contraintes (serveur)"
ok "$(Q "INSERT INTO payment_intents ($COLS) VALUES ($ROW) RETURNING status")" "pending" "paiement préparé : statut « pending »"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ($ROW)")" "duplicate key" "même référence refusée"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0002', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'trial', 'monthly', 'XOF', 5000, 0, 5000)")" "payment_intents_plan_check" "formule « essai » refusée"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0003', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'weekly', 'XOF', 5000, 0, 5000)")" "payment_intents_billing_period_check" "durée inconnue refusée"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0004', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'xof', 5000, 0, 5000)")" "payment_intents_currency_check" "devise mal écrite refusée"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0005', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 5000, 0, 6000)")" "payment_intents_check" "montant demandé > prix refusé"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0006', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 5000, 0, 0)")" "payment_intents_check" "montant demandé à 0 refusé"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('court', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 5000, 0, 5000)")" "payment_intents_reference_check" "référence trop courte refusée"
ok "$(ERR "INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0007', 'orange', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 5000, 0, 5000)")" "payment_intents_gateway_check" "passerelle inconnue refusée"

echo "── 3. Règlement unique (mise à jour conditionnelle)"
ok "$(Q "UPDATE payment_intents SET status='paid', paid_amount=55000, settled_at=now() WHERE reference='SS-test-0001' AND status='pending' RETURNING status")" "paid" "1er règlement : la ligne passe à « paid »"
ok "$(Q "WITH u AS (UPDATE payment_intents SET status='paid' WHERE reference='SS-test-0001' AND status='pending' RETURNING 1) SELECT count(*) FROM u")" "0" "2e règlement : aucune ligne (déjà réglée)"
ok "$(ERR "UPDATE payment_intents SET status='gratuit' WHERE reference='SS-test-0001'")" "payment_intents_status_check" "statut inconnu refusé"

echo "── 4. Comptes connectés et anonymes"
JWT="SET request.jwt.claims = '{\"role\":\"authenticated\"}';"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT SELECT count(*) FROM payment_intents" 2>&1 | tail -1)" "0" "compte connecté : ne voit aucune ligne"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT INSERT INTO payment_intents ($COLS) VALUES ('SS-test-0100', 'flutterwave', null, 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 10000, 0, 10000)" 2>&1 | grep -oE 'permission denied|réservée au serveur' | head -1)" "permission denied" "compte connecté : préparation refusée"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT UPDATE payment_intents SET status='paid' WHERE true" 2>&1 | grep -oE 'permission denied|réservée au serveur' | head -1)" "permission denied" "compte connecté : règlement refusé"
ok "$(P -d $DB -c "SET ROLE anon; SET request.jwt.claims = '{\"role\":\"anon\"}'; SELECT count(*) FROM payment_intents" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "anonyme : aucun accès"
ok "$(P -d $DB -c "SET test.super = 'oui'; SET ROLE authenticated; $JWT SELECT count(*) FROM payment_intents" 2>&1 | tail -1)" "1" "super administrateur : lecture permise"

echo "── 5. Retour arrière"
P -d $DB -f supabase/rollbacks/204_payment_intents_rollback.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "retour arrière exécuté"
ok "$(Q "SELECT count(*) FROM pg_tables WHERE tablename='payment_intents'")" "0" "table retirée"
P -d $DB -f supabase/migrations/204_payment_intents.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
