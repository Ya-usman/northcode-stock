#!/bin/bash
# Validation LOCALE de 217 (liste d'attente des métiers) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : création, relance sans erreur, une ligne par métier + contact, contrôles des données (e-mail en minuscules,
# téléphone en chiffres, métier, sous-métier, langue, pays), aucun accès anonyme ou connecté (droits retirés ET garde
# de la 154 si un droit était rendu par erreur), retour arrière puis réapplication.
# request_is_restricted et guard_server_only_columns : texte EXACT de la migration 154 (is_super_admin doublé).
# Usage (racine du dépôt) : bash supabase/drafts/217_local_validation.sh   (KEEP=1 garde la base)
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r217
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(waitlist_check|waitlist_sector_contact_uidx|permission denied|droit refusé|réservée au serveur)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

RESTRICTED=$(sed -n '/^CREATE OR REPLACE FUNCTION request_is_restricted/,/^END \$\$;/p' supabase/migrations/154_security_guards.sql)
GUARD=$(sed -n '/^CREATE OR REPLACE FUNCTION guard_server_only_columns/,/^END \$\$;/p' supabase/migrations/154_security_guards.sql)
[ -n "$RESTRICTED" ] && [ -n "$GUARD" ] || { echo "fonctions de la 154 introuvables"; exit 2; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL >/dev/null || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Comme sur Supabase : droits par défaut accordés aux rôles de l'API sur les nouvelles tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql AS 'SELECT false';
$RESTRICTED
$GUARD
SQL

apply() { P -d $DB -c "BEGIN" -f supabase/migrations/217_waitlist.sql -c "COMMIT" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' || echo appliquée; }
ok "$(apply)" "appliquée" "217 appliquée"
ok "$(apply)" "appliquée" "relance sans erreur (idempotente)"

SR="SET ROLE service_role;"
ins() { echo "$SR INSERT INTO waitlist (sector, sub_trade, contact, contact_kind, locale, country) VALUES ($1);"; }
ok "$(Q "$(ins "'health', 'pharmacy', 'ami@exemple.cm', 'email', 'fr', 'CM'") SELECT count(*) FROM waitlist")" "1" "serveur : inscription Santé / pharmacie par e-mail"
ok "$(ERR "$(ins "'health', 'clinic', 'ami@exemple.cm', 'email', 'fr', 'CM'")")" "waitlist_sector_contact_uidx" "même contact, même métier : refusé (une ligne par métier + contact)"
ok "$(Q "$(ins "'education', NULL, 'ami@exemple.cm', 'email', 'fr', NULL") SELECT count(*) FROM waitlist")" "2" "même contact, autre métier : accepté"
ok "$(Q "$(ins "'rental', NULL, '+237699001122', 'phone', 'ha', 'NG'") SELECT count(*) FROM waitlist")" "3" "téléphone avec indicatif : accepté"
ok "$(ERR "$(ins "'health', NULL, 'Ami@Exemple.cm', 'email', 'fr', NULL")")" "waitlist_check" "e-mail en majuscules : refusé (contact normalisé par le serveur)"
ok "$(ERR "$(ins "'health', NULL, 'pas-un-email', 'email', 'fr', NULL")")" "waitlist_check" "e-mail sans @ : refusé"
ok "$(ERR "$(ins "'health', NULL, '6990 abc', 'phone', 'fr', NULL")")" "waitlist_check" "téléphone avec lettres ou espaces : refusé"
ok "$(ERR "$(ins "'casino', NULL, 'b@exemple.cm', 'email', 'fr', NULL")")" "waitlist_check" "métier inconnu : refusé"
ok "$(ERR "$(ins "'health', 'Pharmacie!', 'c@exemple.cm', 'email', 'fr', NULL")")" "waitlist_check" "sous-métier hors format : refusé"
ok "$(ERR "$(ins "'health', NULL, 'd@exemple.cm', 'email', 'de', NULL")")" "waitlist_check" "langue inconnue : refusée"
ok "$(ERR "$(ins "'health', NULL, 'e@exemple.cm', 'email', 'fr', 'cm'")")" "waitlist_check" "pays en minuscules : refusé"
ok "$(Q "$SR UPDATE waitlist SET signups = signups + 1, updated_at = now() WHERE sector = 'health' AND contact = 'ami@exemple.cm' RETURNING signups")" "2" "serveur : réinscription comptée sur la même ligne"
ok "$(ERR "$SR UPDATE waitlist SET signups = 0 WHERE sector = 'health'")" "waitlist_check" "compteur jamais à 0"

# Comptes anonymes et connectés : aucun droit, malgré les droits par défaut du schéma
ok "$(ERR "SET ROLE anon; SELECT count(*) FROM waitlist")" "permission denied" "anonyme : lecture refusée"
ok "$(ERR "SET ROLE anon; INSERT INTO waitlist (sector, contact, contact_kind) VALUES ('health', 'f@exemple.cm', 'email')")" "permission denied" "anonyme : inscription directe refusée (passe par le serveur)"
ok "$(ERR "SET ROLE authenticated; SELECT count(*) FROM waitlist")" "permission denied" "compte connecté : lecture refusée"
ok "$(ERR "SET ROLE authenticated; DELETE FROM waitlist")" "permission denied" "compte connecté : suppression refusée"
# Si un droit était rendu par erreur : la garde de la 154 refuse quand même toute écriture
P -d $DB -c "GRANT INSERT, UPDATE, DELETE ON waitlist TO authenticated" >/dev/null
ok "$(ERR "SET ROLE authenticated; SELECT set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', false); INSERT INTO waitlist (sector, contact, contact_kind) VALUES ('health', 'g@exemple.cm', 'email')")" "réservée au serveur" "droit rendu par erreur : la garde refuse encore l'écriture"
P -d $DB -c "REVOKE ALL ON waitlist FROM authenticated" >/dev/null
ok "$(Q "SELECT count(*) FROM pg_policies WHERE tablename = 'waitlist'")" "0" "aucune règle d'accès ouverte (lecture réservée au serveur)"

# Retour arrière puis réapplication
ok "$(P -d $DB -c "BEGIN" -f supabase/rollbacks/217_waitlist_rollback.sql -c "COMMIT" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' || echo ok)" "ok" "retour arrière"
ok "$(Q "SELECT to_regclass('public.waitlist') IS NULL")" "t" "table retirée"
ok "$(apply)" "appliquée" "réapplication après retour arrière"

[ "${KEEP:-0}" = "1" ] || P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"
[ "$fail" = 0 ]
