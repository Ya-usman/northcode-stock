#!/bin/bash
# Banc local de la 191 (nom court et couleur des boutiques) sur une base PostgreSQL JETABLE (port 55432).
# Usage : bash supabase/drafts/191_local_validation.sh
# (commandes -c en ASCII : sous Windows, un « é » passé en argument arrive mal encodé)
B="/c/Program Files/PostgreSQL/18/bin"; export PGCLIENTENCODING=UTF8
P() { "$B/psql.exe" -h localhost -p 55432 -U postgres "$@"; }
P -q -c "DROP DATABASE IF EXISTS b191" 2>/dev/null; P -q -c "CREATE DATABASE b191"
P -d b191 -q <<'SQL'
CREATE TABLE public.entities (id uuid primary key default gen_random_uuid(), name text);
CREATE TABLE public.shops (id uuid primary key default gen_random_uuid(), entity_id uuid references public.entities(id),
  name text, created_at timestamptz not null default now(), deleted_at timestamptz);
INSERT INTO public.entities (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Marché Soleil'), ('00000000-0000-0000-0000-0000000000e2', 'Autre');
-- Rattachement automatique à l'entreprise (comme trg_shops_assign_entity en ligne) : doit passer AVANT la couleur
CREATE FUNCTION public.shops_assign_entity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.entity_id IS NULL AND NEW.name LIKE 'Auto%' THEN NEW.entity_id := '00000000-0000-0000-0000-0000000000e1'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_shops_assign_entity BEFORE INSERT ON public.shops FOR EACH ROW EXECUTE FUNCTION public.shops_assign_entity();
INSERT INTO public.shops (name, entity_id, created_at) VALUES
  ('Marché Soleil Akwa', '00000000-0000-0000-0000-0000000000e1', '2026-01-01'),
  ('Marché Soleil Bonapriso', '00000000-0000-0000-0000-0000000000e1', '2026-01-02'),
  ('Marché Soleil Bastos', '00000000-0000-0000-0000-0000000000e1', '2026-01-03'),
  ('Autre 1', '00000000-0000-0000-0000-0000000000e2', '2026-01-01');
SQL
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3 (obtenu « $1 », attendu « $2 »)"; fi; }
run() { P -d b191 -v ON_ERROR_STOP=1 -q --single-transaction -f "$1" >/dev/null 2>&1; echo $?; }
q() { P -d b191 -tA -q -c "$1" 2>/dev/null | tail -1; }
fails() { P -d b191 -q -c "$1" >/dev/null 2>&1; echo $?; }
E1=00000000-0000-0000-0000-0000000000e1; E2=00000000-0000-0000-0000-0000000000e2

ok "$(run supabase/migrations/191_shop_short_name_color.sql)" 0 "191 appliquée"
ok "$(run supabase/migrations/191_shop_short_name_color.sql)" 0 "191 ré-exécutable"
ok "$(q "select string_agg(color, ',' order by created_at) from shops where entity_id='$E1'")" "blue,violet,teal" "existantes : couleurs dans l'ordre de création (Akwa, Bonapriso, Bastos)"
ok "$(q "select color from shops where entity_id='$E2'")" blue "autre entreprise : sa propre palette (bleu)"
ok "$(q "select count(*) from shops where color is null")" 0 "aucune boutique sans couleur"
ok "$(q "insert into shops (name, entity_id) values ('Deido', '$E1') returning color")" pink "nouvelle boutique : première teinte libre (rose)"
ok "$(q "insert into shops (name) values ('Auto Kotto') returning entity_id || ' ' || color")" "$E1 indigo" "rattachée à l'entreprise par l'autre déclencheur PUIS couleur libre (indigo)"
ok "$(q "insert into shops (name, entity_id, color) values ('Choisie', '$E1', 'amber') returning color")" amber "couleur fournie : conservée"
P -d b191 -q -c "insert into shops (name, entity_id) select 'Rempl ' || g, '$E1' from generate_series(1, 2) g" >/dev/null
ok "$(q "insert into shops (name, entity_id) values ('Neuvieme', '$E1') returning color")" blue "palette pleine (8 teintes prises) : on recommence au bleu, sans erreur"
ok "$(q "insert into shops (name) values ('Sans entreprise') returning color")" blue "sans entreprise : bleu"
P -d b191 -q -c "update shops set color = 'teal' where name = 'Choisie'" >/dev/null
ok "$(fails "update shops set color = 'red' where name = 'Choisie'")" 1 "couleur hors palette (rouge) : refusée"
ok "$(fails "update shops set short_name = 'Akwa' where name like '%Akwa'")" 0 "nom court enregistré"
ok "$(fails "update shops set short_name = ' akwa ' where name like '%Bonapriso'")" 1 "même nom court dans l'entreprise (casse, espaces) : refusé"
ok "$(fails "update shops set short_name = 'Akwa' where entity_id = '$E2'")" 0 "même nom court dans une AUTRE entreprise : accepté"
P -d b191 -q -c "update shops set deleted_at = now() where name like '%Akwa'" >/dev/null
ok "$(fails "update shops set short_name = 'Akwa' where name like '%Bonapriso'")" 0 "boutique supprimée : son nom court se libère"
ok "$(fails "update shops set short_name = '   ' where name like '%Bastos'")" 1 "nom court vide : refusé"
ok "$(fails "update shops set short_name = repeat('x', 21) where name like '%Bastos'")" 1 "nom court de 21 caractères : refusé"
ok "$(fails "update shops set short_name = repeat('x', 20) where name like '%Bastos'")" 0 "nom court de 20 caractères : accepté"
ok "$(fails "update shops set short_name = null where name like '%Bastos'")" 0 "nom court effacé (retour à la règle automatique)"
ok "$(run supabase/rollbacks/191_shop_short_name_color_rollback.sql)" 0 "retour arrière appliqué"
ok "$(q "select count(*) from information_schema.columns where table_name='shops' and column_name in ('short_name','color')")" 0 "retour arrière : colonnes retirées"
ok "$(q "select count(*) from pg_trigger where tgname='trg_shops_set_color'")" 0 "retour arrière : déclencheur retiré"
ok "$(run supabase/migrations/191_shop_short_name_color.sql)" 0 "191 ré-appliquée après le retour arrière"
echo; echo "$pass réussis, $fail échec(s)"
P -q -c "DROP DATABASE IF EXISTS b191" >/dev/null 2>&1
[ "$fail" = 0 ]
