#!/bin/bash
# Validation LOCALE de 187 (messages du support masqués par le propriétaire) — base PostgreSQL jetable UNIQUEMENT,
# jamais la production. Applique le fichier EXACT du dépôt avec la CLI Supabase (db push), puis vérifie les droits
# avec les VRAIES fonctions de protection (154 : request_is_restricted, guard_server_only_columns ; 006 :
# is_super_admin) et les VRAIES politiques du propriétaire (039) et le verrou (160).
# Usage (racine du dépôt) : bash supabase/drafts/187_local_validation.sh
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
ok "$(sha256sum "$WORK/main/supabase/migrations/187_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/187_"*.sql | cut -c1-64)" "copie exacte de la 187"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 187 | tr '\n' ' ')"
# Fonctions de protection reprises telles quelles de leurs fichiers
sed -n '/^CREATE OR REPLACE FUNCTION request_is_restricted/,/^-- ── 3\./p' "$REPO/supabase/migrations/154_security_guards.sql" > "$WORK/154.sql"
sed -n '/^CREATE OR REPLACE FUNCTION is_super_admin/,/^\$\$ LANGUAGE sql SECURITY DEFINER STABLE;/p' "$REPO/supabase/migrations/006_super_admin.sql" > "$WORK/006.sql"
sed -n '/^CREATE POLICY "notifs_owner_read"/,/^  );/p;/^CREATE POLICY "notifs_owner_mark_read"/,/^  );/p' "$REPO/supabase/migrations/039_admin_support_tables.sql" > "$WORK/039.sql"
grep -A1 '^CREATE TRIGGER trg_admin_notifications_guard' "$REPO/supabase/migrations/160_lock_browser_writes.sql" > "$WORK/160.sql"

S=a0000000-0000-0000-0000-00000000000a
OWNER=10000000-0000-0000-0000-000000000001; CASHIER=10000000-0000-0000-0000-000000000002; STRANGER=10000000-0000-0000-0000-000000000003
N=20000000-0000-0000-0000-000000000001

P -d postgres -c "drop database if exists r187" -c "create database r187" >/dev/null
P -d r187 <<SQL || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid \$f\$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text);
CREATE TABLE public.shops (id uuid PRIMARY KEY);
CREATE TABLE public.shop_members (shop_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'urgent')), title text NOT NULL, message text NOT NULL,
  read_at timestamptz DEFAULT NULL, created_at timestamptz DEFAULT now());
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
INSERT INTO public.profiles VALUES ('$OWNER', 'owner'), ('$CASHIER', 'cashier'), ('$STRANGER', 'owner');
INSERT INTO public.shops VALUES ('$S');
INSERT INTO public.shop_members VALUES ('$S', '$OWNER', 'owner', true), ('$S', '$CASHIER', 'cashier', true);
INSERT INTO public.admin_notifications (id, shop_id, title, message) VALUES ('$N', '$S', 'Bienvenue', 'Bonjour');
SQL
for f in 006 154 039 160; do P -d r187 -f "$WORK/$f.sql" >/dev/null || { echo "reprise de $f impossible"; exit 2; }; done
P -d r187 -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role" >/dev/null
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL r187)" --workdir "$WORK/main" > "$WORK/repair.log" || { echo "repair local impossible"; cat "$WORK/repair.log"; exit 2; }

Q() { P -d r187 -c "$1" 2>&1 | tail -1; }
# Requête « navigateur » : rôle authenticated + jeton de la personne, dans une transaction
AS() { P -d r187 -v VERBOSITY=verbose -c "set role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$1\"}', true); $2" 2>&1 | tail -1; }
# Erreur attendue : sortie COMPLÈTE (en mode détaillé, psql ajoute CONTEXTE et EMPLACEMENT après la ligne ERROR)
ASERR() { P -d r187 -v VERBOSITY=verbose -c "set role authenticated; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$1\"}', true); $2" 2>&1; }
CODE() { echo "$1" | grep -oE 'ERROR: +[0-9A-Z]{5}' | head -1 | grep -oE '[0-9A-Z]{5}$' || echo "$1" | tail -1; }

echo "── 1. Avant : historique 001 → 186 enregistré"
DRY="$(CLI db push --dry-run --db-url "$(URL r187)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "187_admin_notifications_dismissed.sql" "db push --dry-run : exactement la 187"

echo "── 2. db push"
CLI db push --yes --db-url "$(URL r187)" --workdir "$WORK/main" | grep -E "ERROR" | sed 's/^/      /'
ok "$(Q "select string_agg(version, ' ') from supabase_migrations.schema_migrations where version >= '187'")" "187" "historique : 187 enregistrée"
ok "$(Q "select data_type || '|' || is_nullable || '|' || coalesce(column_default, '') from information_schema.columns where table_name = 'admin_notifications' and column_name = 'dismissed_at'")" "timestamp with time zone|YES|" "colonne dismissed_at : horodatage, vide par défaut"
ok "$(Q "select count(*) from public.admin_notifications where dismissed_at is null")" "1" "messages existants : aucun masqué"

echo "── 3. Droits (vraies politiques 039 et vrai verrou 160)"
ok "$(AS "$OWNER" "update public.admin_notifications set dismissed_at = now(), read_at = coalesce(read_at, now()) where id = '$N' returning 'masque'")" "masque" "propriétaire : masque son message (et le marque lu)"
ok "$(CODE "$(ASERR "$OWNER" "update public.admin_notifications set title = 'Pirate' where id = '$N'")")" "42501" "propriétaire : texte du message toujours intouchable (42501)"
# Suppression : aucune politique DELETE pour le propriétaire, la base ne voit aucune ligne à supprimer (0 ligne, pas
# d'erreur) ; l'essentiel est vérifié : le message est toujours là
ok "$(AS "$OWNER" "with d as (delete from public.admin_notifications where id = '$N' returning 1) select count(*) from d")" "0" "propriétaire : suppression sans effet (0 ligne, aucune politique de suppression)"
ok "$(Q "select count(*) from public.admin_notifications where id = '$N'")" "1" "le message est toujours en base (historique côté administration)"
ok "$(CODE "$(ASERR "$OWNER" "insert into public.admin_notifications (shop_id, title, message) values ('$S', 'x', 'y')")")" "42501" "propriétaire : création refusée (réservée au serveur)"
ok "$(AS "$OWNER" "update public.admin_notifications set dismissed_at = null where id = '$N' returning 'reaffiche'")" "reaffiche" "propriétaire : peut aussi annuler le masquage"
ok "$(AS "$CASHIER" "with u as (update public.admin_notifications set dismissed_at = now() where id = '$N' returning 1) select count(*) from u")" "0" "caissier de la boutique : ne peut rien masquer"
ok "$(AS "$STRANGER" "with u as (update public.admin_notifications set dismissed_at = now() where id = '$N' returning 1) select count(*) from u")" "0" "propriétaire d'une autre boutique : ne voit ni ne masque rien"
ok "$(AS "$OWNER" "select count(*) from public.admin_notifications where id = '$N' and dismissed_at is null")" "1" "lecture par le propriétaire : colonne visible"

echo "── 4. Ré-exécution et retour arrière"
P -d r187 -f "$REPO/supabase/migrations/187_admin_notifications_dismissed.sql" >/dev/null 2>&1; ok "$?" "0" "187 ré-exécutable sans erreur"
P -d r187 -f "$REPO/supabase/rollbacks/187_admin_notifications_dismissed_rollback.sql" >/dev/null 2>&1; ok "$?" "0" "retour arrière exécuté"
ok "$(Q "select count(*) from information_schema.columns where table_name = 'admin_notifications' and column_name = 'dismissed_at'")" "0" "retour arrière : colonne retirée"
ok "$(Q "select title || '|' || message from public.admin_notifications where id = '$N'")" "Bienvenue|Bonjour" "retour arrière : message intact"

[ -n "${KEEP:-}" ] || P -d postgres -c "drop database if exists r187" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"
[ "$fail" = 0 ]
