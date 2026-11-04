#!/bin/bash
# Validation LOCALE de 213 (protection de l'essai) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : registre créé, empreintes au bon format, règles (motif d'un essai accordé à la main, numéro obligatoire
# hors admin), registre gardé à la suppression d'une entreprise, aucun accès des comptes connectés ou anonymes,
# état de l'essai, ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/213_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r213
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '([a-z_]+_check|permission denied|réservée au serveur)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
H=$(printf 'a%.0s' $(seq 1 64)); H2=$(printf 'b%.0s' $(seq 1 64))

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE entities (id uuid primary key, name text, plan text, trial_ends_at timestamptz);
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
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000001', 'SOFAR', 'trial', now() + interval '20 days');
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000002', 'Test', 'trial', now() + interval '20 days');
GRANT ALL ON entities TO authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/213_trial_claims.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "exécution n° $i"; done

echo "── 2. Existant inchangé"
ok "$(Q "SELECT coalesce(trial_status, 'aucun') || '/' || plan FROM entities WHERE name = 'SOFAR'")" "aucun/trial" "entreprise existante : état d'essai vide, formule inchangée"

echo "── 3. Registre"
ok "$(Q "INSERT INTO trial_claims (entity_id, phone_hash, device_hash, source, granted) VALUES ('e0000000-0000-0000-0000-000000000002', '$H', '$H2', 'register', true) RETURNING granted")" "t" "essai accordé enregistré (empreintes)"
ok "$(ERR "INSERT INTO trial_claims (phone_hash, source, granted) VALUES ('+237690000000', 'register', true)")" "trial_claims_check" "numéro EN CLAIR refusé (empreinte seulement)"
ok "$(ERR "INSERT INTO trial_claims (source, granted) VALUES ('register', true)")" "trial_claims_check" "inscription sans numéro refusée"
ok "$(ERR "INSERT INTO trial_claims (entity_id, source, granted) VALUES ('e0000000-0000-0000-0000-000000000002', 'admin', true)")" "trial_claims_check" "essai accordé à la main sans motif refusé"
ok "$(Q "INSERT INTO trial_claims (entity_id, source, granted, granted_by, reason) VALUES ('e0000000-0000-0000-0000-000000000002', 'admin', true, 'e0000000-0000-0000-0000-000000000009', 'Numero partage en famille') RETURNING source")" "admin" "essai accordé à la main avec motif accepté"
ok "$(ERR "INSERT INTO trial_claims (phone_hash, source, granted) VALUES ('$H', 'autre', true)")" "trial_claims_check" "origine inconnue refusée"

echo "── 4. Registre gardé à la suppression du compte"
P -d $DB -c "DELETE FROM entities WHERE name = 'Test'" >/dev/null
ok "$(Q "SELECT count(*) || '/' || count(entity_id) FROM trial_claims")" "2/0" "lignes gardées, entreprise détachée"
ok "$(Q "SELECT count(*) FROM trial_claims WHERE phone_hash = '$H'")" "1" "le numéro reste reconnu après suppression"

echo "── 5. État de l'essai"
ok "$(Q "UPDATE entities SET trial_status = 'pending_phone' RETURNING trial_status")" "pending_phone" "en attente du téléphone (Google)"
ok "$(ERR "UPDATE entities SET trial_status = 'gratuit'")" "entities_trial_status_check" "état inconnu refusé"

echo "── 6. Accès"
JWT="SET request.jwt.claims = '{\"role\":\"authenticated\"}';"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT SELECT count(*) FROM trial_claims" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "compte connecté : registre illisible"
ok "$(P -d $DB -c "SET ROLE anon; SELECT count(*) FROM trial_claims" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "anonyme : registre illisible"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT INSERT INTO trial_claims (phone_hash, source, granted) VALUES ('$H2', 'register', true)" 2>&1 | grep -oE 'permission denied' | head -1)" "permission denied" "compte connecté : aucune écriture"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT UPDATE entities SET trial_status = 'granted'" 2>&1 | grep -oE 'réservée au serveur' | head -1)" "réservée au serveur" "compte connecté : état de l'essai non modifiable"
ok "$(P -d $DB -c "SET ROLE service_role; SELECT count(*) FROM trial_claims" 2>&1 | tail -1)" "2" "serveur : registre lisible"

echo "── 7. Retour arrière"
P -d $DB -f supabase/rollbacks/213_trial_claims_rollback.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "retour arrière exécuté"
ok "$(Q "SELECT (to_regclass('public.trial_claims') IS NULL)::text || '/' || count(*) FROM information_schema.columns WHERE column_name = 'trial_status'")" "true/0" "registre et colonne retirés"
P -d $DB -f supabase/migrations/213_trial_claims.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
