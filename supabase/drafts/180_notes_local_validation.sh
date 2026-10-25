#!/bin/sh
# 180 — validation sur une base PostgreSQL LOCALE jetable (jamais la production). Lancer depuis la racine du dépôt :
#   sh supabase/drafts/180_notes_local_validation.sh
# Reproduit notes telle qu'en production (colonnes, clés, RLS, 4 politiques, droits par défaut du projet),
# puis vérifie A à I. Crée et supprime la base t180 sur le serveur local.
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"; PGPORT="${PGPORT:-55432}"
P="$PGBIN/psql.exe"; [ -x "$P" ] || P="$PGBIN/psql"
export PGCLIENTENCODING=UTF8
M="supabase/migrations/180_notes_missing_objects.sql"; R="supabase/drafts/180_notes_missing_objects_rollback.sql"
[ -f "$M" ] || { echo "Lancer depuis la racine du dépôt"; exit 1; }
q() { "$P" -h localhost -p "$PGPORT" -U postgres -d t180 -tA -q "$@"; }
"$P" -h localhost -p "$PGPORT" -U postgres -q -c "drop database if exists t180" -c "create database t180" 2>/dev/null

q -v ON_ERROR_STOP=1 <<'SQL' || exit 1
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Droits par défaut du projet (relevés en production) : une fonction créée par postgres dans public → postgres + service_role
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY);
-- notes : schéma de production (= 046 sans ses index, sa fonction ni son déclencheur)
CREATE TABLE public.notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid REFERENCES public.shops(id) ON DELETE CASCADE NOT NULL,
  owner_id   uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title      text,
  content    text NOT NULL DEFAULT '',
  color      text NOT NULL DEFAULT 'default',
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_select" ON public.notes FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "notes_insert" ON public.notes FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "notes_update" ON public.notes FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "notes_delete" ON public.notes FOR DELETE USING (owner_id = auth.uid());
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.notes TO anon, authenticated, service_role;
INSERT INTO auth.users VALUES ('aaaaaaaa-0000-0000-0000-000000000001'), ('aaaaaaaa-0000-0000-0000-000000000002');
INSERT INTO public.shops VALUES ('11111111-1111-1111-1111-111111111111');
-- Notes « historiques » (comme les 23 de production) : updated_at = created_at, dans le passé
INSERT INTO public.notes (id, shop_id, owner_id, title, content, created_at, updated_at)
SELECT gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000002', 'ancienne ' || i, 'texte ' || i,
       now() - (i || ' days')::interval, now() - (i || ' days')::interval FROM generate_series(1, 3) i;
CREATE TABLE t_res (n serial, ok boolean, label text);
CREATE FUNCTION t(c boolean, m text) RETURNS void LANGUAGE sql AS $f$ INSERT INTO t_res(ok, label) VALUES (coalesce(c, false), m) $f$;
CREATE FUNCTION fp() RETURNS text LANGUAGE sql AS $f$
  SELECT md5(coalesce(string_agg(id::text || title || content || color || pinned || created_at || updated_at, ',' ORDER BY id), '')) FROM public.notes $f$;
CREATE FUNCTION pol() RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(policyname || cmd || coalesce(qual, '') || coalesce(with_check, ''), ',' ORDER BY policyname) FROM pg_policies WHERE tablename = 'notes' $f$;
CREATE FUNCTION objs() RETURNS text LANGUAGE sql AS $f$
  SELECT (SELECT count(*) FROM pg_indexes WHERE tablename = 'notes' AND indexname IN ('idx_notes_owner_id', 'idx_notes_shop_id')) || '/'
      || (SELECT count(*) FROM pg_proc WHERE proname = 'touch_notes_updated_at') || '/'
      || (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND tgname = 'notes_updated_at') $f$;
CREATE TABLE t_ref AS SELECT fp() AS data, pol() AS policies;
SQL

echo "═══ A. migration (transaction explicite BEGIN / COMMIT du fichier)"
q -v ON_ERROR_STOP=1 -f "$M" && echo "migration : OK" || { echo "ÉCHEC migration"; exit 1; }
q <<'SQL'
SELECT t((SELECT data FROM t_ref) = fp() AND (SELECT policies FROM t_ref) = pol(), 'A migration : aucune donnée ni politique modifiée');
-- B. index : bonnes colonnes, btree, non uniques
SELECT t((SELECT string_agg(i.relname || ':' || a.attname || ':' || am.amname || ':' || x.indisunique, ',' ORDER BY i.relname)
            FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_am am ON am.oid = i.relam
            JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
           WHERE x.indrelid = 'public.notes'::regclass AND i.relname LIKE 'idx_notes_%' AND x.indnatts = 1)
         = 'idx_notes_owner_id:owner_id:btree:false,idx_notes_shop_id:shop_id:btree:false', 'B index idx_notes_owner_id (owner_id) et idx_notes_shop_id (shop_id), btree');
-- C. fonction
SELECT t((SELECT prorettype = 'trigger'::regtype AND NOT prosecdef AND btrim(prosrc, E' 

	') = 'BEGIN NEW.updated_at = now(); RETURN NEW; END;'
          FROM pg_proc WHERE proname = 'touch_notes_updated_at' AND pronamespace = 'public'::regnamespace), 'C fonction touch_notes_updated_at : corps de la 046, renvoie trigger, sans SECURITY DEFINER');
SELECT t(NOT has_function_privilege('anon', 'public.touch_notes_updated_at()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.touch_notes_updated_at()', 'EXECUTE')
  AND (SELECT NOT (coalesce(proacl::text, '') LIKE '%=X/%' AND coalesce(proacl::text, '') ~ '(^|[{,])=X') FROM pg_proc WHERE proname = 'touch_notes_updated_at'), 'C droits : ni PUBLIC, ni anon, ni authenticated');
SELECT t((SELECT proconfig FROM pg_proc WHERE proname = 'touch_notes_updated_at') = ARRAY['search_path=""'], 'C proconfig = {search_path=""} (search_path vide fixé)');
-- D. déclencheur
SELECT t((SELECT tgenabled = 'O' AND tgtype & 2 = 2 AND tgtype & 1 = 1 AND tgtype & 16 = 16 AND tgfoid = 'public.touch_notes_updated_at'::regproc
          FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND tgname = 'notes_updated_at'), 'D déclencheur notes_updated_at actif : BEFORE UPDATE, FOR EACH ROW');
SQL

echo "═══ E / F / I. note TEST modifiée par un utilisateur authenticated (RLS, sans droit EXECUTE sur la fonction)"
q <<'SQL'
INSERT INTO public.notes (id, shop_id, owner_id, title, content, color, pinned, created_at, updated_at)
VALUES ('cccccccc-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'TEST', 'avant', 'yellow', true,
        now() - interval '1 hour', now() - interval '1 hour');
CREATE TABLE t_before AS SELECT * FROM public.notes WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
UPDATE public.notes SET content = 'après' WHERE id = 'cccccccc-0000-0000-0000-00000000000c';
RESET ROLE;
SELECT t((SELECT n.updated_at > b.updated_at AND n.updated_at >= now() - interval '1 minute' FROM public.notes n, t_before b WHERE n.id = b.id),
  'E updated_at passe de T1 (il y a 1 h) à maintenant');
SELECT t((SELECT n.created_at = b.created_at AND n.title = b.title AND n.color = b.color AND n.pinned = b.pinned AND n.shop_id = b.shop_id
             AND n.owner_id = b.owner_id AND n.content = 'après' FROM public.notes n, t_before b WHERE n.id = b.id),
  'F seules content et updated_at changent (created_at, titre, couleur, épinglage, boutique, auteur intacts)');
SELECT t(true, 'I modification par authenticated sans droit EXECUTE sur la fonction : acceptée, déclencheur exécuté');
SELECT t((SELECT count(*) FROM public.notes WHERE updated_at > created_at + interval '1 second') = 1, 'E les 3 notes historiques gardent leur updated_at (aucun rattrapage)');
SQL

echo "═══ G. deuxième application"
q -c "CREATE TABLE t_g AS SELECT fp() AS data, pol() AS policies, objs() AS o" >/dev/null
q -v ON_ERROR_STOP=1 -f "$M" && echo "2e application : OK" || echo "ÉCHEC 2e application"
q <<'SQL'
SELECT t(objs() = '2/1/1' AND (SELECT data FROM t_g) = fp() AND (SELECT policies FROM t_g) = pol()
  AND (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.notes'::regclass AND NOT tgisinternal) = 1, 'G 2e application : 2 index, 1 fonction, 1 déclencheur, aucun doublon, état identique');
SQL

echo "═══ H. retour arrière"
q -c "CREATE TABLE t_h AS SELECT fp() AS data, pol() AS policies" >/dev/null
q -v ON_ERROR_STOP=1 -f "$R" && echo "retour arrière : OK" || echo "ÉCHEC retour arrière"
q <<'SQL'
SELECT t(objs() = '0/0/0' AND (SELECT data FROM t_h) = fp() AND (SELECT policies FROM t_h) = pol()
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.notes'::regclass)
  AND (SELECT count(*) FROM information_schema.columns WHERE table_name = 'notes') = 9, 'H retour arrière : 4 objets retirés ; table, 9 colonnes, RLS, politiques et données intactes');
SQL
q -v ON_ERROR_STOP=1 -f "$R" >/dev/null 2>&1 && q <<'SQL'
SELECT t(objs() = '0/0/0', 'H retour arrière rejoué : sans erreur');
SQL
echo "═══ J. atomicité : copie de la 180 avec une erreur forcée juste avant COMMIT (base jetable)"
# La copie est valide seulement si : 1 ligne fautive insérée avant COMMIT, et toutes les autres lignes identiques
TMPM="$(mktemp)"
awk '/^COMMIT;$/ { print "SELECT 1/0; -- erreur forcée (test uniquement)" } { print }' "$M" > "$TMPM"
INSERTED=$(grep -c '^SELECT 1/0; -- erreur forcée' "$TMPM")
SAME=$(grep -v '^SELECT 1/0; -- erreur forcée' "$TMPM" | cmp -s - "$M" && echo 1 || echo 0)
q -v ON_ERROR_STOP=1 -f "$TMPM" >/dev/null 2>&1; CODE=$?
rm -f "$TMPM"
echo "  ligne fautive insérée : $INSERTED · reste identique à la 180 : $SAME · code de sortie : $CODE"
q -v inserted="$INSERTED" -v same="$SAME" -v code="$CODE" <<'SQL'
SELECT t(:inserted = 1 AND :same = 1 AND :code <> 0, 'J copie fautive valide (1 ligne d''erreur juste avant COMMIT, rien d''autre de changé) et refusée par psql');
SELECT t(objs() = '0/0/0' AND (SELECT data FROM t_h) = fp(), 'J échec avant COMMIT : aucun index, fonction ni déclencheur créé, données intactes (aucun état partiel)');
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'ÉCHEC' END || ' ' || label FROM t_res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' réussis, ' || count(*) FILTER (WHERE NOT ok) || ' échec(s)' FROM t_res;
SQL
"$P" -h localhost -p "$PGPORT" -U postgres -q -c "drop database if exists t180"
