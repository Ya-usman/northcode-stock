#!/bin/bash
# Validation LOCALE de 186 (prolongation à partir de maintenant, demandes de prolongation) — base PostgreSQL jetable
# UNIQUEMENT, jamais la production. Applique le fichier EXACT du dépôt avec la CLI Supabase (db push).
# Usage (racine du dépôt) : bash supabase/drafts/186_local_validation.sh
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
ok "$(sha256sum "$WORK/main/supabase/migrations/186_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/186_"*.sql | cut -c1-64)" "copie exacte de la 186"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 186 | tr '\n' ' ')"
# Fonctions d'origine (108) reprises telles quelles de leur fichier
sed -n '/^CREATE OR REPLACE FUNCTION shop_utc_offset_minutes/,$p' "$REPO/supabase/migrations/108_shop_hours_extension.sql" > "$WORK/108.sql"

A=a0000000-0000-0000-0000-00000000000a; E=a0000000-0000-0000-0000-00000000000e
U1=10000000-0000-0000-0000-000000000001; U2=10000000-0000-0000-0000-000000000002

schema() {
P -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null
P -d "$1" <<SQL || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
ALTER ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, country text, timezone text NOT NULL, hours_enabled boolean DEFAULT true,
  opening_time time, closing_time time, hours_manual_override text, hours_extension_until timestamptz,
  hours_extension_count int NOT NULL DEFAULT 0, hours_extension_count_date date);
INSERT INTO auth.users VALUES ('$U1'), ('$U2');
SQL
P -d "$1" -f "$WORK/108.sql" >/dev/null || { echo "fonctions de la 108 impossibles"; exit 2; }
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL "$1")" --workdir "$WORK/main" > "$WORK/repair-$1.log" || { echo "repair local impossible"; cat "$WORK/repair-$1.log"; exit 2; }
}
Q() { P -d r186 -c "$1" 2>&1 | tail -1; }
reset() { P -d r186 -c "delete from public.shops; insert into public.shops (id, country, timezone, opening_time, closing_time) values ('$A', 'CM', 'Africa/Douala', '08:00', '20:00'), ('$E', 'FR', 'Europe/Paris', '08:00', '20:00')" >/dev/null; }
G() { Q "select (public.grant_hours_extension('$1'::uuid, $2, '$3'::timestamptz) ->> 'hours_extension_until')::timestamptz at time zone 'UTC'"; }
# Code d'erreur (SQLSTATE) : mode détaillé de psql (« ERROR:  P0053: … »)
CODE() { local o; o="$(P -d r186 -v VERBOSITY=verbose -c "$1" 2>&1)"; echo "$o" | grep -oE 'P00[0-9]{2}' | head -1 | grep . || echo "$o" | grep -oE 'ERROR:.*' | head -1; }

echo "── 1. Base jetable « r186 » (fonctions de la 108 en place), historique 001 → 185 enregistré"
schema r186
DRY="$(CLI db push --dry-run --db-url "$(URL r186)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "186_hours_extension_requests.sql" "db push --dry-run : exactement la 186"
OLD_MD5="$(Q "select md5(prosrc) from pg_proc where proname = 'grant_hours_extension'")"

echo "── 2. db push"
PUSH="$(CLI db push --yes --db-url "$(URL r186)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|ERROR" | sed 's/^/      /'
ok "$(Q "select string_agg(version, ' ') from supabase_migrations.schema_migrations where version >= '186'")" "186" "historique : 186 enregistrée"

echo "── 3. Prolongation (Boutique A à Douala, 08:00 à 20:00 locales = 07:00 à 19:00 UTC)"
reset
ok "$(G $A 60 '2026-10-29 18:30Z')" "2026-10-29 20:00:00" "AVANT la fermeture (19:30 locale), +1 h : part de la fermeture → 21:00 locale (comme avant)"
reset
ok "$(G $A 60 '2026-10-29 20:14Z')" "2026-10-29 21:14:00" "APRÈS la fermeture (21:14 locale), +1 h : part de MAINTENANT → 22:14 locale (avant : 21:00, inutile)"
ok "$(G $A 30 '2026-10-29 20:20Z')" "2026-10-29 21:44:00" "seconde prolongation +30 min : part de la prolongation en cours (22:14) → 22:44 locale"
ok "$(CODE "select public.grant_hours_extension('$A', 30, '2026-10-29 20:30Z')")" "P0053" "troisième prolongation le même jour : refusée (limite de 2, code P0053)"
ok "$(G $A 30 '2026-10-30 18:00Z')" "2026-10-30 19:30:00" "le lendemain : compteur remis à zéro, prolongation accordée"
reset
ok "$(Q "select (public.grant_hours_extension('$A', 120, '2026-10-29 22:30Z')) ->> 'capped'")/$(Q "select hours_extension_until at time zone 'UTC' from public.shops where id = '$A'")" "true/2026-10-29 22:59:00" "23:30 locale, +2 h : arrêtée à 23:59 locale (au lieu d'échouer), signalée"
ok "$(CODE "select public.grant_hours_extension('$A', 15, '2026-10-29 22:59:30Z')")" "P0054" "23:59 locale : plus de prolongation possible aujourd'hui (P0054)"
reset
ok "$(G $E 30 '2026-07-01 18:30Z')" "2026-07-01 19:00:00" "Paris en été (UTC+2), 20:30 locale : +30 min depuis maintenant → 21:00 locale (fuseau de la boutique)"
P -d r186 -c "update public.shops set hours_manual_override = 'closed' where id = '$A'" >/dev/null
ok "$(CODE "select public.grant_hours_extension('$A', 30, '2026-10-29 20:14Z')")" "P0052" "dérogation manuelle active : refusée (P0052)"
reset
ok "$(CODE "select public.grant_hours_extension('$A', 90, '2026-10-29 20:14Z')")" "P0050" "durée non prévue (90 min) : refusée (P0050)"
P -d r186 -c "update public.shops set hours_enabled = false where id = '$A'" >/dev/null
ok "$(CODE "select public.grant_hours_extension('$A', 30, '2026-10-29 20:14Z')")" "P0051" "horaires désactivés : refusée (P0051)"

echo "── 4. Demandes de prolongation"
reset
ok "$(Q "set role authenticated; select count(*) from public.hours_extension_requests" | grep -c 'permission denied')" "1" "navigateur (authenticated) : table des demandes illisible"
ok "$(Q "set role anon; select public.grant_hours_extension('$A', 30)" | grep -c 'permission denied')" "1" "anon : prolongation non exécutable"
ok "$(Q "set role authenticated; select public.approve_hours_extension_request(gen_random_uuid(), '$U1')" | grep -c 'permission denied')" "1" "authenticated : acceptation non exécutable (serveur seulement)"
R1="$(Q "insert into public.hours_extension_requests (shop_id, requested_by, minutes, created_at, expires_at) values ('$A', '$U1', 60, '2026-10-29 20:14Z', '2026-10-29 20:44Z') returning id")"
ok "$(CODE "insert into public.hours_extension_requests (shop_id, requested_by, minutes) values ('$A', '$U1', 30)" | grep -c '23505\|duplicate\|unique')" "1" "une seule demande en attente par personne et par boutique"
ok "$(CODE "insert into public.hours_extension_requests (shop_id, requested_by, minutes) values ('$A', '$U2', 45)" | grep -c 'check\|violates')" "1" "durée de demande hors 30 / 60 / 120 : refusée"
ok "$(Q "select ((public.approve_hours_extension_request('$R1', '$U2', NULL, '2026-10-29 20:20Z')) ->> 'hours_extension_until')::timestamptz at time zone 'UTC'")" "2026-10-29 21:20:00" "acceptée à 21:20 locale : 1 h à partir de maintenant → 22:20 locale"
ok "$(Q "select status || '/' || (decided_by = '$U2') || '/' || (granted_until at time zone 'UTC') from public.hours_extension_requests where id = '$R1'")" "approved/true/2026-10-29 21:20:00" "demande close : acceptée, par qui, jusqu'à quand"
ok "$(CODE "select public.approve_hours_extension_request('$R1', '$U2', NULL, '2026-10-29 20:21Z')")" "P0055" "déjà acceptée : ne peut pas l'être deux fois (P0055)"
R2="$(Q "insert into public.hours_extension_requests (shop_id, requested_by, minutes, created_at, expires_at) values ('$A', '$U1', 30, '2026-10-29 20:25Z', '2026-10-29 20:55Z') returning id")"
ok "$([ -n "$R2" ] && echo oui)" "oui" "après acceptation, une nouvelle demande est possible"
ok "$(CODE "select public.approve_hours_extension_request('$R2', '$U2', NULL, '2026-10-29 21:00Z')")" "P0055" "demande expirée (plus de 30 min) : ne peut plus être acceptée"
ok "$(Q "select hours_extension_count from public.shops where id = '$A'")" "1" "demande expirée : aucune prolongation accordée en plus"

echo "── 5. Retour arrière exact"
P -d r186 -f "$REPO/supabase/rollbacks/186_hours_extension_requests_rollback.sql" >/dev/null
ok "$(Q "select pg_get_function_identity_arguments(oid) || ' / ' || md5(prosrc) from pg_proc where proname = 'grant_hours_extension'")" "p_shop_id uuid, p_minutes integer / $OLD_MD5" "rollback 186 : fonction de la 108 rétablie à l'identique (signature et corps)"
ok "$(Q "select count(*) from pg_class where relname = 'hours_extension_requests'")/$(Q "select count(*) from pg_proc where proname = 'approve_hours_extension_request'")" "0/0" "rollback 186 : table et fonction d'acceptation retirées"
reset
ok "$(Q "select (public.grant_hours_extension('$A', 60) ->> 'hours_extension_count')")" "1" "rollback 186 : l'ancienne prolongation fonctionne"

echo "── 6. Échec : la table des demandes existe déjà"
schema r186fail
P -d r186fail -c "create table public.hours_extension_requests (id int)" >/dev/null
OUT="$(CLI db push --yes --db-url "$(URL r186fail)" --workdir "$WORK/main")"
ok "$(P -d r186fail -c "select coalesce(string_agg(version, ' '), '') from supabase_migrations.schema_migrations where version >= '186'")|$(P -d r186fail -c "select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'grant_hours_extension'")" "|p_shop_id uuid, p_minutes integer" "→ 186 annulée entière (absente de l'historique, ancienne prolongation intacte)"

for d in r186 r186fail; do P -d postgres -c "drop database if exists $d" >/dev/null; done
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
