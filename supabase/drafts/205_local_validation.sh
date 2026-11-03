#!/bin/bash
# Validation LOCALE de 205 (conditions des clients actuels) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : remplissage des seules entreprises qui paient (prix et devise selon le pays, limites de l'ancienne formule,
# fin = échéance + 3 mois), comptes internes / essais / formules échues exclus, jamais d'écrasement, contrainte,
# droits retirés sur payment_intents, ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/205_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r205
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(entities_legacy_terms_check)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE entities (id text primary key, name text, plan text, plan_expires_at timestamptz, is_internal boolean, country text, billing_country text);
CREATE TABLE payment_intents (id int primary key);
GRANT ALL ON payment_intents TO authenticated;
INSERT INTO entities VALUES
  ('alpha',   'Groupe Boutique Alpha', 'business', '2027-01-10T00:00:00Z', false, 'NG', 'NG'),
  ('sofar',   'Groupe SOFAR',          'pro',      '2027-01-01T00:00:00Z', false, 'NE', 'NE'),
  ('douala',  'Boutique Douala',       'starter',  '2027-02-01T00:00:00Z', null,  'CM', null),
  ('soleil',  'Marché Soleil',         'business', '2027-11-12T00:00:00Z', true,  'CM', 'CM'),
  ('essai',   'Essai',                 'trial',    null,                   false, 'CI', 'CI'),
  ('echu',    'Ancien client',         'pro',      '2026-08-28T00:00:00Z', false, 'CI', 'CI'),
  ('paris',   'Boutique Paris',        'pro',      '2027-03-01T00:00:00Z', false, 'FR', 'FR'),
  ('4a8d9624-509f-40cc-ab4d-5119a4e6a456', 'SOFAR BONKANEY', 'pro', '2026-12-02T00:00:00Z', false, 'NE', 'NE');
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/205_legacy_terms.sql >/dev/null 2>&1 && R=ok || R=ko; ok "$R" "ok" "exécution n° $i"; done
T() { Q "SELECT coalesce(legacy_terms ->> '$2', 'null') FROM entities WHERE id = '$1'"; }

echo "── 2. Remplissage"
ok "$(T alpha plan)/$(T alpha shops)/$(T alpha team_members)" "business/10/30" "Alpha : ancien Business, 10 boutiques, 30 employés"
ok "$(T alpha currency) $(T alpha monthly_price)" "NGN 19999" "Alpha : ancien prix 19 999 NGN (le nouveau, 15 000, sera appliqué car moins cher)"
ok "$(T alpha limits_until)" "2027-04-10T00:00:00Z" "Alpha : limites jusqu'à l'échéance + 3 mois"
ok "$(T sofar plan)/$(T sofar shops)/$(T sofar team_members) $(T sofar currency) $(T sofar monthly_price)" "pro/2/5 XOF 7999" "SOFAR (Niger) : Pro, 7 999 XOF garanti"
ok "$(T douala plan) $(T douala currency) $(T douala monthly_price)" "starter XAF 4999" "Cameroun sans pays de facturation : pays de l'entreprise, XAF"
ok "$(T paris plan) $(T paris currency) $(T paris monthly_price)" "pro null null" "France : limites gardées, aucun prix garanti"
ok "$(Q "SELECT count(*) FROM entities WHERE id IN ('soleil','essai','echu') AND legacy_terms IS NOT NULL")" "0" "compte interne, essai et formule échue : rien"
B=4a8d9624-509f-40cc-ab4d-5119a4e6a456
ok "$(T $B plan)/$(T $B shops)/$(T $B team_members) $(T $B currency) $(T $B monthly_price)" "pro/2/5 null null" "SOFAR BONKANEY : limites gardées, nouveaux prix à son renouvellement (décision du 3 nov.)"

echo "── 3. Jamais d'écrasement"
P -d $DB -c "UPDATE entities SET plan = 'business' WHERE id = 'sofar'" >/dev/null
P -d $DB -f supabase/migrations/205_legacy_terms.sql >/dev/null 2>&1
ok "$(T sofar plan)" "pro" "rejouée après un changement de formule : conditions d'origine gardées"

echo "── 4. Contrainte"
ok "$(ERR "UPDATE entities SET legacy_terms = '{\"plan\":\"gold\",\"shops\":1,\"team_members\":1,\"limits_until\":\"2027-01-01\"}' WHERE id='essai'")" "entities_legacy_terms_check" "formule inconnue refusée"
ok "$(ERR "UPDATE entities SET legacy_terms = '{\"plan\":\"pro\",\"shops\":1.5,\"team_members\":1,\"limits_until\":\"2027-01-01\"}' WHERE id='essai'")" "entities_legacy_terms_check" "nombre de boutiques non entier refusé"
ok "$(ERR "UPDATE entities SET legacy_terms = '{\"plan\":\"pro\",\"shops\":2,\"team_members\":5,\"limits_until\":\"2027-01-01\",\"monthly_price\":7999}' WHERE id='essai'")" "entities_legacy_terms_check" "prix sans devise refusé"
ok "$(ERR "UPDATE entities SET legacy_terms = '{\"plan\":\"pro\",\"shops\":2,\"team_members\":5,\"limits_until\":\"2027-01-01\",\"monthly_price\":0,\"currency\":\"XOF\"}' WHERE id='essai'")" "entities_legacy_terms_check" "prix à 0 refusé"
ok "$(ERR "UPDATE entities SET legacy_terms = '{\"plan\":\"pro\",\"team_members\":5,\"limits_until\":\"2027-01-01\"}' WHERE id='essai'")" "entities_legacy_terms_check" "clé manquante (boutiques) refusée"
ok "$(Q "UPDATE entities SET legacy_terms = '{\"plan\":\"pro\",\"shops\":2,\"team_members\":5,\"limits_until\":\"2027-01-01\",\"monthly_price\":null,\"currency\":null}' WHERE id='essai' RETURNING 'ok'")" "ok" "conditions sans prix acceptées"
P -d $DB -c "UPDATE entities SET legacy_terms = NULL WHERE id='essai'" >/dev/null

echo "── 5. Paiements préparés : droits retirés"
ok "$(Q "SELECT string_agg(privilege_type, ',' ORDER BY privilege_type) FROM information_schema.table_privileges WHERE table_name = 'payment_intents' AND grantee = 'authenticated'")" "DELETE,INSERT,SELECT,UPDATE" "TRUNCATE, REFERENCES, TRIGGER retirés (le reste est réglé par la 204)"

echo "── 6. Retour arrière"
P -d $DB -f supabase/rollbacks/205_legacy_terms_rollback.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "retour arrière exécuté"
ok "$(Q "SELECT count(*) FROM information_schema.columns WHERE table_name='entities' AND column_name='legacy_terms'")" "0" "colonne retirée"
P -d $DB -f supabase/migrations/205_legacy_terms.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
