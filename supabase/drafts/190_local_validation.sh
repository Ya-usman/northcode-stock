#!/bin/bash
# Banc local de la 190 (demandes de transfert + réglage d'entreprise) sur une base PostgreSQL JETABLE (port 55432).
# Usage : bash supabase/drafts/190_local_validation.sh
B="/c/Program Files/PostgreSQL/18/bin"; export PGCLIENTENCODING=UTF8
P() { "$B/psql.exe" -h localhost -p 55432 -U postgres "$@"; }
P -q -c "DROP DATABASE IF EXISTS b190" 2>/dev/null; P -q -c "CREATE DATABASE b190"
P -d b190 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid primary key default gen_random_uuid());
CREATE TABLE public.entities (id uuid primary key default gen_random_uuid(), name text);
CREATE TABLE public.shops (id uuid primary key default gen_random_uuid(), entity_id uuid references public.entities(id), name text);
CREATE TABLE public.products (id uuid primary key default gen_random_uuid(), shop_id uuid references public.shops(id), name text);
CREATE TABLE public.stock_transfers (id uuid primary key default gen_random_uuid());
GRANT SELECT ON public.entities TO authenticated;
INSERT INTO public.entities (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'E');
INSERT INTO public.shops (id, entity_id, name) VALUES ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'A'), ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'B');
INSERT INTO public.products (id, shop_id, name) VALUES ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000b1', 'Coca');
INSERT INTO public.stock_transfers (id) VALUES ('00000000-0000-0000-0000-0000000000c1');
SQL
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3 (obtenu « $1 », attendu « $2 »)"; fi; }
run() { P -d b190 -v ON_ERROR_STOP=1 -q --single-transaction -f "$1" >/dev/null 2>&1; echo $?; }
q() { P -d b190 -tA -q -c "$1" 2>/dev/null | tail -1; }
fails() { P -d b190 -q -c "$1" >/dev/null 2>&1; echo $?; }
A=00000000-0000-0000-0000-0000000000a1; Bs=00000000-0000-0000-0000-0000000000b1; PR=00000000-0000-0000-0000-0000000000f1
ok "$(run supabase/migrations/190_stock_transfer_requests.sql)" 0 "190 appliquée"
ok "$(run supabase/migrations/190_stock_transfer_requests.sql)" 0 "190 ré-exécutable"
ok "$(q "select share_stock_with_sellers from entities limit 1")" t "réglage activé par défaut"
ok "$(q "select has_column_privilege('authenticated','public.entities','share_stock_with_sellers','SELECT')")" t "réglage lisible comme le reste de l'entreprise"
ok "$(q "select has_table_privilege('authenticated','public.stock_transfer_requests','SELECT')")" f "demandes : illisibles par le navigateur"
ok "$(q "select has_table_privilege('anon','public.stock_transfer_requests','INSERT')")" f "demandes : anon ne peut rien écrire"
ok "$(q "select has_table_privilege('service_role','public.stock_transfer_requests','SELECT')")" t "demandes : lisibles par le serveur"
ok "$(q "insert into stock_transfer_requests (requesting_shop_id, source_shop_id, source_product_id, product_name, quantity) values ('$A','$Bs','$PR','Coca',10) returning status")" pending "demande créée en attente"
ok "$(fails "insert into stock_transfer_requests (requesting_shop_id, source_shop_id, source_product_id, product_name, quantity) values ('$A','$Bs','$PR','Coca',5)")" 1 "seconde demande en attente pour le même produit : refusée"
ok "$(fails "insert into stock_transfer_requests (requesting_shop_id, source_shop_id, source_product_id, product_name, quantity) values ('$Bs','$Bs','$PR','Coca',5)")" 1 "même boutique des deux côtés : refusée"
ok "$(fails "insert into stock_transfer_requests (requesting_shop_id, source_shop_id, source_product_id, product_name, quantity) values ('$Bs','$A','$PR','Coca',0)")" 1 "quantité 0 : refusée"
ok "$(fails "update stock_transfer_requests set status='accepted' where status='pending'")" 1 "acceptée sans transfert : refusée"
ok "$(q "update stock_transfer_requests set status='accepted', transfer_id='00000000-0000-0000-0000-0000000000c1' where status='pending' returning status")" accepted "acceptée avec son transfert"
ok "$(q "insert into stock_transfer_requests (requesting_shop_id, source_shop_id, source_product_id, product_name, quantity) values ('$A','$Bs','$PR','Coca',3) returning status")" pending "nouvelle demande possible une fois la précédente traitée"
ok "$(fails "update stock_transfer_requests set status='lost'")" 1 "statut inconnu : refusé"
ok "$(run supabase/rollbacks/190_stock_transfer_requests_rollback.sql)" 0 "retour arrière"
ok "$(q "select count(*) from information_schema.tables where table_name='stock_transfer_requests'")" 0 "table retirée"
ok "$(q "select count(*) from information_schema.columns where table_name='entities' and column_name='share_stock_with_sellers'")" 0 "réglage retiré"
ok "$(q "select count(*) from shops")" 2 "boutiques intactes"
ok "$(run supabase/migrations/190_stock_transfer_requests.sql)" 0 "190 ré-appliquée après retour arrière"
echo "$pass réussis, $fail échec(s)"
