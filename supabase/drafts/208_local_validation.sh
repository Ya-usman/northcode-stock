#!/bin/bash
# Validation LOCALE de 208 (pays de tarification) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : activité ajoutée de façon atomique (une ligne par entreprise, jour, pays), code pays en majuscules, jours
# anciens effacés, fonction et table interdites aux comptes connectés et anonymes, pays fixé avec motif obligatoire,
# colonnes des paiements préparés, ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/208_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r208
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
CREATE TABLE entities (id uuid primary key, name text);
CREATE TABLE payment_intents (id serial primary key, reference text);
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.super', true), '') = 'oui' $$;
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', NULLIF(current_setting('request.jwt.claim.role', true), ''));
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END $$;
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT request_is_restricted() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000001', 'SOFAR');
GRANT ALL ON entities, payment_intents TO authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/208_pricing_country.sql >/dev/null 2>&1 && R=ok || R=ko; ok "$R" "ok" "exécution n° $i"; done

echo "── 2. Activité ajoutée de façon atomique"
P -d $DB -c "SELECT bump_entity_activity('$E', 'ne', 3, 0); SELECT bump_entity_activity('$E', 'NE', 2, 1); SELECT bump_entity_activity('$E', 'FR', 0, 4);" >/dev/null
ok "$(Q "SELECT string_agg(country || ':' || ops || '/' || logins, ',' ORDER BY country) FROM entity_activity_countries")" "FR:0/4,NE:5/1" "Niger 5 opérations + 1 connexion, France 4 connexions (majuscules, une ligne par pays)"
P -d $DB -c "INSERT INTO entity_activity_countries VALUES ('$E', current_date - 200, 'CI', 9, 0)" >/dev/null
P -d $DB -c "SELECT bump_entity_activity('$E', 'NE', 1, 0)" >/dev/null
ok "$(Q "SELECT count(*) FROM entity_activity_countries WHERE country = 'CI'")" "0" "jour de plus de 120 jours effacé au passage"
ok "$(ERR "INSERT INTO entity_activity_countries VALUES ('$E', current_date, 'FRA', 1, 0)")" "entity_activity_countries_country_check" "code pays de 3 lettres refusé"

echo "── 3. Accès"
JWT="SET request.jwt.claims = '{\"role\":\"authenticated\"}';"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT SELECT bump_entity_activity('$E', 'US', 99, 0)" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "compte connecté : fonction refusée (activité impossible à fausser)"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT SELECT count(*) FROM entity_activity_countries" 2>&1 | tail -1)" "0" "compte connecté : ne voit rien"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT INSERT INTO entity_activity_countries VALUES ('$E', current_date, 'US', 99, 0)" 2>&1 | grep -oE 'permission denied|réservée au serveur' | head -1)" "permission denied" "compte connecté : écriture directe refusée"
ok "$(P -d $DB -c "SET ROLE anon; SET request.jwt.claims = '{\"role\":\"anon\"}'; SELECT count(*) FROM entity_activity_countries" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "anonyme : aucun accès"

echo "── 4. Pays fixé par l'administration"
ok "$(ERR "UPDATE entities SET pricing_country = 'FR' WHERE id = '$E'")" "entities_pricing_country_check" "pays sans motif refusé"
ok "$(ERR "UPDATE entities SET pricing_country = 'FRA', pricing_country_reason = 'Boutique a Lyon' WHERE id = '$E'")" "entities_pricing_country_check" "code pays invalide refusé"
ok "$(Q "UPDATE entities SET pricing_country = 'FR', pricing_country_reason = 'Boutique a Lyon', pricing_country_set_at = now() WHERE id = '$E' RETURNING pricing_country")" "FR" "pays avec motif accepté"
ok "$(Q "UPDATE entities SET pricing_country = NULL, pricing_country_reason = NULL WHERE id = '$E' RETURNING coalesce(pricing_country, 'aucun')")" "aucun" "retour à la règle automatique"

echo "── 5. Paiements préparés"
ok "$(Q "INSERT INTO payment_intents (reference, request_country, payer_country, pricing_reason, pricing_country) VALUES ('x', 'FR', 'FR', 'declared', 'NE') RETURNING pricing_reason")" "declared" "pays de la demande, du paiement et de tarification enregistrés"
ok "$(ERR "INSERT INTO payment_intents (reference, pricing_reason) VALUES ('y', 'devine')")" "payment_intents_countries_check" "raison inconnue refusée"

echo "── 6. Retour arrière"
P -d $DB -f supabase/rollbacks/208_pricing_country_rollback.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "retour arrière exécuté"
ok "$(Q "SELECT count(*) FROM information_schema.columns WHERE (table_name = 'entities' AND column_name LIKE 'pricing%') OR (table_name = 'payment_intents' AND column_name IN ('request_country','payer_country','pricing_reason','pricing_country')) OR table_name = 'entity_activity_countries'")" "0" "table et colonnes retirées"
P -d $DB -f supabase/migrations/208_pricing_country.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
