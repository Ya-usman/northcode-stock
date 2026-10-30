#!/bin/bash
# Banc local de la 189 (délai de livraison fournisseur) sur une base PostgreSQL JETABLE (port 55432), jamais la prod.
# Reproduit les droits de colonne de la 183 sur suppliers (navigateur : toutes sauf total_owed), puis vérifie :
# application, ré-exécution, colonne entière nullable, illisible par le navigateur, lisible par le serveur, bornes
# 0..180, retour arrière sans perte de lignes, ré-application. Usage : bash supabase/drafts/189_local_validation.sh
B="/c/Program Files/PostgreSQL/18/bin"; export PGCLIENTENCODING=UTF8
P() { "$B/psql.exe" -h localhost -p 55432 -U postgres "$@"; }
P -q -c "DROP DATABASE IF EXISTS b189" && P -q -c "CREATE DATABASE b189"
P -d b189 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.suppliers (id uuid primary key default gen_random_uuid(), shop_id uuid, name text not null, phone text, city text,
  created_at timestamptz default now(), deleted_at timestamptz, email text, total_owed numeric default 0);
GRANT ALL ON public.suppliers TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT (id, shop_id, name, phone, city, created_at, deleted_at, email) ON public.suppliers TO authenticated;
INSERT INTO public.suppliers (name) VALUES ('A'), ('B');
SQL
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3 (obtenu « $1 », attendu « $2 »)"; fi; }
run() { P -d b189 -v ON_ERROR_STOP=1 -q --single-transaction -f "$1" >/dev/null 2>&1; echo $?; }
q() { P -d b189 -tA -c "$1" 2>/dev/null | tail -1; }
ok "$(run supabase/migrations/189_supplier_lead_time.sql)" 0 "189 appliquée"
ok "$(run supabase/migrations/189_supplier_lead_time.sql)" 0 "189 ré-exécutable"
ok "$(q "select data_type||'/'||is_nullable from information_schema.columns where table_name='suppliers' and column_name='lead_time_days'")" "integer/YES" "colonne entière, facultative"
ok "$(q "select has_column_privilege('authenticated','public.suppliers','lead_time_days','SELECT')")" f "illisible par le navigateur"
ok "$(q "select has_column_privilege('service_role','public.suppliers','lead_time_days','SELECT')")" t "lisible par le serveur"
ok "$(q "select has_column_privilege('authenticated','public.suppliers','total_owed','SELECT')")" f "total_owed toujours réservé au serveur"
q "update suppliers set lead_time_days=5 where name='A'" >/dev/null
ok "$(q "select lead_time_days from suppliers where name='A'")" 5 "délai 5 enregistré"
P -d b189 -q -c "update suppliers set lead_time_days=181 where name='A'" >/dev/null 2>&1; ok "$?" 1 "181 jours refusé"
P -d b189 -q -c "update suppliers set lead_time_days=-1 where name='A'" >/dev/null 2>&1; ok "$?" 1 "-1 jour refusé"
ok "$(run supabase/rollbacks/189_supplier_lead_time_rollback.sql)" 0 "retour arrière"
ok "$(q "select count(*) from information_schema.columns where table_name='suppliers' and column_name='lead_time_days'")" 0 "colonne retirée"
ok "$(q "select count(*) from suppliers")" 2 "aucune ligne perdue"
ok "$(run supabase/migrations/189_supplier_lead_time.sql)" 0 "189 ré-appliquée après retour arrière"
echo "$pass réussis, $fail échec(s)"
