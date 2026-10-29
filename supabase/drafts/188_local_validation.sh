#!/bin/bash
# Validation LOCALE de 188 (transferts V1 : brouillon, envoi lot par lot, QR, réception définitive avec écarts) — base PostgreSQL jetable UNIQUEMENT, jamais la production.
# Rejoue les VRAIES migrations 102 et 104 (transferts actuels) et les VRAIES fonctions de la 178 (date métier, stock
# vendable), crée 3 transferts « ancien modèle », applique le fichier EXACT 188 avec la CLI Supabase (db push), puis
# vérifie chaque règle et le retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/188_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8   # fichiers et arguments en UTF-8 (sinon accents mal lus sous Windows)
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
REPO="$(pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
URL() { echo "postgresql://postgres@$HOST:$PORT/$1?sslmode=disable"; }
CLI() { npx --yes supabase@2.122.0 "$@" < /dev/null 2>&1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
DB=r188
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
# Code d'erreur (SQLSTATE) en mode détaillé : « ERROR:  P0067: … »
CODE() { local o; o="$(P -d $DB -v VERBOSITY=verbose -c "$1" 2>&1)"; echo "$o" | grep -oE 'ERROR: +[0-9A-Z]{5}' | head -1 | grep -oE '[0-9A-Z]{5}$' || echo "pas d'erreur"; }
DETAIL() { P -d $DB -v VERBOSITY=verbose -c "$1" 2>&1 | grep -oE '\{"[^}]*\}' | head -1; }   # JSON du détail (le mot « DÉTAIL » peut arriver mal encodé)

mkdir -p "$WORK/main/supabase/migrations"; cp "$REPO"/supabase/migrations/*.sql "$WORK/main/supabase/migrations/"
ok "$(sha256sum "$WORK/main/supabase/migrations/188_"*.sql | cut -c1-64)" "$(sha256sum "$REPO/supabase/migrations/188_"*.sql | cut -c1-64)" "copie exacte de la 188"
OLD_VERSIONS="$(ls "$WORK/main/supabase/migrations" | grep -E '^[0-9]+_.*\.sql$' | sed -E 's/^([0-9]+)_.*/\1/' | grep -vx 188 | tr '\n' ' ')"
# Fonctions de la 178 reprises telles quelles (date métier, stock vendable)
sed -n '/^CREATE OR REPLACE FUNCTION public.shop_business_date/,/^\$\$;/p;/^CREATE OR REPLACE FUNCTION public.sellable_stock/,/^\$\$;/p' "$REPO/supabase/migrations/178_expired_not_sellable.sql" > "$WORK/178.sql"

E1=e0000000-0000-0000-0000-0000000000e1; E2=e0000000-0000-0000-0000-0000000000e2
A=a0000000-0000-0000-0000-00000000000a; B=b0000000-0000-0000-0000-00000000000b; N=c0000000-0000-0000-0000-00000000000c; X=d0000000-0000-0000-0000-00000000000d
U=10000000-0000-0000-0000-000000000001
PA=11111111-0000-0000-0000-0000000000a1; PB=11111111-0000-0000-0000-0000000000b1; PL=11111111-0000-0000-0000-0000000000a2
L1=22222222-0000-0000-0000-000000000001; L2=22222222-0000-0000-0000-000000000002; L3=22222222-0000-0000-0000-000000000003

setup() {
DB=$1
echo "── 0. Base jetable « $DB » : schéma minimal + VRAIES migrations 102 / 104 + fonctions de la 178"
P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END \$\$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.audit_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, entity_id uuid, actor_id uuid, actor_email text,
  action text, target_id text, target_type text, metadata jsonb, ip text, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS \$f\$ SELECT NULL::uuid \$f\$;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.shops (id uuid PRIMARY KEY, name text, entity_id uuid, currency text, timezone text, owner_id uuid);
CREATE TABLE public.shop_members (shop_id uuid, user_id uuid, role text, is_active boolean DEFAULT true);
CREATE FUNCTION public.is_shop_member(p uuid) RETURNS boolean LANGUAGE sql STABLE AS \$f\$ SELECT true \$f\$;
CREATE TABLE public.products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id), name text NOT NULL,
  unit text DEFAULT 'piece', buying_price numeric NOT NULL DEFAULT 0, selling_price numeric NOT NULL, quantity int NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true, barcode text, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.product_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  supplier_id uuid, quantity int NOT NULL CHECK (quantity >= 0), initial_quantity int, buying_price numeric, expiry_date date,
  source text NOT NULL CONSTRAINT product_batches_source_check CHECK (source IN ('backfill', 'restock', 'purchase_order', 'adjustment')),
  received_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  promo_price numeric, promo_until date, promo_start date, origin_inventory_session_id uuid);
CREATE TABLE public.batch_treatments (id uuid PRIMARY KEY);
CREATE TABLE public.stock_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL, type text NOT NULL CONSTRAINT stock_movements_type_check CHECK (type IN ('in', 'out', 'adjustment', 'sale')),
  quantity int NOT NULL, reason text, notes text, performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, created_at timestamptz DEFAULT now(),
  previous_qty int, new_qty int, count_session_id uuid,
  batch_id uuid REFERENCES public.product_batches(id), batch_treatment_id uuid REFERENCES public.batch_treatments(id));
CREATE INDEX idx_stock_movements_batch ON public.stock_movements (batch_id) WHERE batch_id IS NOT NULL;
INSERT INTO auth.users VALUES ('$U');
INSERT INTO public.shops VALUES ('$A', 'Akwa', '$E1', 'XAF', 'Africa/Douala', '$U'), ('$B', 'Bastos', '$E1', 'XAF', 'Africa/Douala', '$U'),
  ('$N', 'Kano', '$E1', 'NGN', 'Africa/Lagos', '$U'), ('$X', 'Autre entreprise', '$E2', 'XAF', 'Africa/Douala', '$U');
INSERT INTO public.shop_members VALUES ('$A', '$U', 'owner', true), ('$B', '$U', 'owner', true), ('$N', '$U', 'owner', true);
SQL
# Production installée depuis des fichiers en fins de ligne Windows (CRLF) : rejoués à l'identique
for m in 102_stock_transfers 104_fix_transfer_ownership_check; do
  node "$REPO/supabase/drafts/to-crlf.js" "$REPO/supabase/migrations/$m.sql" "$WORK/$m.crlf.sql"
  P -d $DB -f "$WORK/$m.crlf.sql" >/dev/null || { echo "$m impossible"; exit 2; }
done
P -d $DB -f "$WORK/178.sql" >/dev/null || { echo "fonctions de la 178 impossibles"; exit 2; }
# État de production : 175 a ajouté « inventory » ; 182 : lots lisibles colonne par colonne, sans buying_price
P -d $DB <<SQL >/dev/null || { echo "état de production impossible"; exit 2; }
ALTER TABLE public.product_batches DROP CONSTRAINT product_batches_source_check;
ALTER TABLE public.product_batches ADD CONSTRAINT product_batches_source_check CHECK (source IN ('backfill', 'restock', 'purchase_order', 'adjustment', 'transfer', 'inventory'));
REVOKE ALL ON public.product_batches FROM anon, authenticated;
GRANT SELECT (id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at, created_at, updated_at,
  promo_price, promo_until, promo_start, origin_inventory_session_id) ON public.product_batches TO authenticated;
SQL
# Empreintes des fonctions actuelles (le retour arrière doit les recréer à l'identique)
FN_MD5() { Q "select string_agg(proname || '=' || md5(prosrc), ' ' order by proname) from pg_proc where proname in ('send_stock_transfer','receive_stock_transfer','cancel_stock_transfer')"; }
BEFORE_MD5="$(FN_MD5)"
PROD_MD5="cancel_stock_transfer=6b8b7a91ac8d1fc2cb621c70cec16f3b receive_stock_transfer=7d1d89e644988eb8b8b9aa3b7bb54062 send_stock_transfer=f84e25a3724cea5fe12b3f82d4e62da1"
ok "$BEFORE_MD5" "$PROD_MD5" "fonctions 102 / 104 rejouées = empreintes de la PRODUCTION (29 oct. 2026)"

echo "── 1. Transferts « ancien modèle » (fonctions actuelles) : un reçu, un en route, un annulé"
P -d $DB <<SQL >/dev/null || { echo "données anciennes impossibles"; exit 2; }
INSERT INTO public.products (id, shop_id, name, buying_price, selling_price, quantity) VALUES
  ('$PA', '$A', 'Riz 5 kg', 2000, 3000, 100), ('$PL', '$A', 'Lait', 500, 800, 10), ('$PB', '$B', 'Riz 5 kg', 2000, 3100, 5);
SELECT public.send_stock_transfer('$A', '$B', '$U', 'ancien recu', '[{"product_id":"$PA","quantity":4}]');
SELECT public.send_stock_transfer('$A', '$B', '$U', 'ancien en route', '[{"product_id":"$PA","quantity":3}]');
SELECT public.send_stock_transfer('$A', '$B', '$U', 'ancien annule', '[{"product_id":"$PA","quantity":2}]');
SQL
T_OLD_R="$(Q "select id from stock_transfers where notes = 'ancien recu'")"; T_OLD_S="$(Q "select id from stock_transfers where notes = 'ancien en route'")"; T_OLD_C="$(Q "select id from stock_transfers where notes = 'ancien annule'")"
I_OLD_R="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T_OLD_R'")"
P -d $DB -c "select public.receive_stock_transfer('$T_OLD_R', '$B', '$U', '[{\"transfer_item_id\":\"$I_OLD_R\",\"quantity_received\":4,\"destination_product_id\":\"$PB\"}]')" -c "select public.cancel_stock_transfer('$T_OLD_C', '$A', '$U')" >/dev/null || { echo "ancien parcours impossible"; exit 2; }
ok "$(Q "select string_agg(status, ',' order by notes) from stock_transfers")" "cancelled,sent,received" "3 transferts anciens : annulé, en route, reçu"
CLI migration repair --status applied $OLD_VERSIONS --db-url "$(URL $DB)" --workdir "$WORK/main" > "$WORK/repair.log" || { echo "repair local impossible"; cat "$WORK/repair.log"; exit 2; }

echo "── 2. db push de la 188"
DRY="$(CLI db push --dry-run --db-url "$(URL $DB)" --workdir "$WORK/main")"
ok "$(echo "$DRY" | node -e "const t=require('fs').readFileSync(0,'utf8');const j=JSON.parse(t.slice(t.indexOf('{')));console.log(j.migrations.join(' '))")" "188_transfers_workflow.sql" "db push --dry-run : exactement la 188"
PUSH="$(CLI db push --yes --db-url "$(URL $DB)" --workdir "$WORK/main")"; echo "$PUSH" | grep -E "NOTICE|ERROR" | sed 's/^/      /'
ok "$(Q "select string_agg(version, ' ') from supabase_migrations.schema_migrations where version >= '188'")" "188" "historique : 188 enregistrée"
ok "$(Q "select count(*) from information_schema.columns where table_name = 'stock_movements' and column_name = 'batch_id'")" "1" "stock_movements.batch_id (179) réutilisée, pas recréée"
ok "$(Q "select confdeltype from pg_constraint where conname = 'stock_movements_batch_id_fkey'")" "a" "clé étrangère batch_id inchangée (NO ACTION, comme la 179)"

}

setup r188

echo "── 3. Anciens transferts : lisibles, et l'en-route reste réceptionnable"
ok "$(Q "select string_agg(status, ',' order by notes) from stock_transfers")" "cancelled,sent,received" "statuts inchangés"
ok "$(Q "select string_agg(coverage || ':' || quantity_sent || '/' || quantity_received || '/' || quantity_missing || '/' || quantity_returned || '/' || quantity_in_transit, ',' order by quantity_sent) from stock_transfer_allocations")" "legacy:2/0/0/2/0,legacy:3/0/0/0/3,legacy:4/4/0/0/0" "allocations « ancien modèle » : annulé rendu, en route en transit, reçu complet"
ok "$(Q "select count(*) from stock_transfer_tokens where revoked_at is null and transfer_id = '$(Q "select id from stock_transfers where notes = 'ancien en route'")'")" "1" "le transfert encore en route reçoit un jeton de QR"
ok "$(Q "select count(*) from stock_movements where transfer_id is not null")" "5" "anciens mouvements rattachés à leur transfert (3 envois, 1 réception, 1 annulation)"
I_OLD_S="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T_OLD_S'")"
ok "$(Q "select receive_stock_transfer_final('$T_OLD_S', '$B', '$U', gen_random_uuid(), '[{\"item_id\":\"$I_OLD_S\",\"quantity_received\":3,\"destination_product_id\":\"$PB\"}]') ->> 'status'")" "received" "ancien transfert en route : réceptionné avec le nouveau modèle"
ok "$(Q "select quantity || ':' || coalesce(expiry_date::text, 'sans date') || ':' || origin_untracked || ':' || coalesce(buying_price::text, 'inconnu') from product_batches where origin_transfer_id = '$T_OLD_S'")" "3:sans date:true:2000" "lot « origine non tracée » à l'arrivée (date jamais inventée, coût connu car même devise)"
ok "$(Q "select revoked_at is not null from stock_transfer_tokens where transfer_id = '$T_OLD_S'")" "t" "jeton révoqué après la réception"

echo "── 4. Envoi : seulement le stock VENDABLE (règle de la caisse), lots périmés exclus, FEFO"
# Lait : physique 10 = lot frais 5 (péremption dans 10 j) + lot périmé 3 (hier, date de la boutique) + 2 sans lot → vendable 7
P -d $DB -c "insert into product_batches (id, shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at) values
  ('$L1', '$A', '$PL', 5, 5, 450, shop_business_date('$A') + 10, 'restock', now() - interval '3 days'),
  ('$L2', '$A', '$PL', 3, 3, 400, shop_business_date('$A') - 1, 'restock', now() - interval '20 days')" >/dev/null
ok "$(Q "select sellable from sellable_stock('$PL', shop_business_date('$A'))")" "7" "stock vendable du lait (règle de la caisse) : 7"
ok "$(CODE "select create_stock_transfer('$A', '$B', '$U', null, '[{\"product_id\":\"$PL\",\"quantity\":8}]', true)")" "P0067" "envoyer 8 (plus que le vendable) : refusé (P0067)"
ok "$(DETAIL "select create_stock_transfer('$A', '$B', '$U', null, '[{\"product_id\":\"$PL\",\"quantity\":8}]', true)" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.transferable+'/'+j.expired+'/'+j.requested)")" "7/3/8" "détail du refus : transférable 7, périmé 3, demandé 8"
ok "$(Q "select count(*) from stock_transfers where status = 'draft'")" "0" "refus : rien n'est resté (pas de brouillon orphelin)"
T1="$(Q "select create_stock_transfer('$A', '$B', '$U', 'lait', '[{\"product_id\":\"$PL\",\"quantity\":7}]', true) ->> 'id'")"
ok "$(Q "select status || ':' || reference || ':' || (sent_at is not null) from stock_transfers where id = '$T1'")" "sent:TR-$(date +%Y)-0004:true" "envoi de 7 : en transit, référence suivante de la boutique, date d'envoi"
ok "$(Q "select quantity from products where id = '$PL'")" "3" "stock du lait à la source : 10 → 3"
ok "$(Q "select string_agg(quantity::text, ',' order by expiry_date) from product_batches where product_id = '$PL'")" "3,0" "lots source : le périmé (3) intact, le frais (5) entièrement parti"
ok "$(Q "select string_agg(coverage || ':' || quantity_sent || ':' || coalesce(unit_cost::text, 'inconnu'), ',' order by coverage) from stock_transfer_allocations where transfer_id = '$T1'")" "batch:5:450,uncovered:2:500" "allocations : lot frais 5 (coût du lot), 2 sans lot (coût moyen du produit)"
ok "$(Q "select token ~ '^[0-9a-f]{64}\$' and revoked_at is null from stock_transfer_tokens where transfer_id = '$T1'")" "t" "jeton de QR créé à l'envoi (64 caractères aléatoires)"
ok "$(Q "select send_stock_transfer_draft('$T1', '$A', '$U') ->> 'already_sent'")" "true" "renvoyer le même transfert : sans effet (jamais deux fois)"
ok "$(Q "select quantity from products where id = '$PL'")" "3" "stock source inchangé après le renvoi"
ok "$(Q "select count(*) from audit_logs where target_id = '$T1' and action = 'stock_transfer.send'")" "1" "journal « envoyé » écrit une seule fois, dans la transaction"
# FEFO sur plusieurs lots : A 5 (péremption +10) puis B 10 (+40) ; transfert de 8 → 5 de A, 3 de B
PF=11111111-0000-0000-0000-0000000000f1; LA=22222222-0000-0000-0000-0000000000a1; LB=22222222-0000-0000-0000-0000000000b1
P -d $DB -c "insert into products (id, shop_id, name, buying_price, selling_price, quantity) values ('$PF', '$A', 'Yaourt', 300, 500, 15);
  insert into product_batches (id, shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at) values
  ('$LB', '$A', '$PF', 10, 10, 310, shop_business_date('$A') + 40, 'restock', now() - interval '1 day'),
  ('$LA', '$A', '$PF', 5, 5, 290, shop_business_date('$A') + 10, 'restock', now() - interval '9 days')" >/dev/null
TF="$(Q "select create_stock_transfer('$A', '$B', '$U', 'fefo', '[{\"product_id\":\"$PF\",\"quantity\":8}]', true) ->> 'id'")"
ok "$(Q "select string_agg(quantity_sent::text || '@' || (source_batch_id = '$LA')::text, ',' order by source_expiry_date) from stock_transfer_allocations where transfer_id = '$TF'")" "5@true,3@false" "FEFO : 5 du lot qui périme le plus tôt, puis 3 du suivant"

echo "── 5. Réception définitive : exacte, puis avec écart"
I1="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T1'")"
K1="$(Q "select gen_random_uuid()")"
R1="$(Q "select receive_stock_transfer_final('$T1', '$B', '$U', '$K1', '[{\"item_id\":\"$I1\",\"quantity_received\":7}]')")"
ok "$(echo "$R1" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.status+'/'+j.received+'/'+j.missing)")" "received/7/0" "réception exacte : reçu 7, aucun écart"
DEST_PL="$(Q "select destination_product_id from stock_transfer_items where id = '$I1'")"
ok "$(Q "select is_active || ':' || selling_price || ':' || quantity from products where id = '$DEST_PL'")" "true:800:7" "produit créé à l'arrivée (même devise) : actif, prix de la source, 7 en stock"
ok "$(Q "select string_agg(quantity || ':' || coalesce(expiry_date::text, 'sans date') || ':' || coalesce(buying_price::text, 'inconnu') || ':' || coalesce((origin_batch_id = '$L1')::text, '-'), ',' order by quantity desc) from product_batches where product_id = '$DEST_PL'")" "5:$(Q "select shop_business_date('$A') + 10"):450:true,2:sans date:500:-" "lots d'arrivée : même péremption et coût que le lot source ; le stock sans lot arrive sans date (jamais inventée)"
ok "$(Q "select has_discrepancy || ':' || (receipt_key = '$K1') || ':' || (select revoked_at is not null from stock_transfer_tokens where transfer_id = '$T1') from stock_transfers where id = '$T1'")" "false:true:true" "sans écart ; clé de réception gardée ; jeton révoqué"
ok "$(Q "select receive_stock_transfer_final('$T1', '$B', '$U', '$K1', '[{\"item_id\":\"$I1\",\"quantity_received\":7}]') ->> 'replayed'")" "true" "même réception renvoyée par le même appareil : sans effet"
ok "$(CODE "select receive_stock_transfer_final('$T1', '$B', '$U', gen_random_uuid(), '[{\"item_id\":\"$I1\",\"quantity_received\":7}]')")" "P0078" "seconde réception (autre appareil) : « déjà réceptionné » (P0078)"
ok "$(DETAIL "select receive_stock_transfer_final('$T1', '$B', '$U', gen_random_uuid(), '[{\"item_id\":\"$I1\",\"quantity_received\":7}]')" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(!!j.received_at && j.received_by)")" "$U" "détail : date et personne de la première réception"
ok "$(Q "select quantity from products where id = '$DEST_PL'")" "7" "stock d'arrivée augmenté UNE seule fois"
ok "$(Q "select count(*) from audit_logs where target_id = '$T1' and action = 'stock_transfer.receive'")" "1" "journal « reçu » écrit une fois, dans la transaction"
# Écart : riz 10 envoyé, 8 reçus, casse déclarée
P -d $DB -c "insert into product_batches (id, shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at) values ('$L3', '$A', '$PA', 20, 20, 1900, shop_business_date('$A') + 30, 'restock', now())" >/dev/null
T2="$(Q "select create_stock_transfer('$A', '$B', '$U', 'riz', '[{\"product_id\":\"$PA\",\"quantity\":10}]', true) ->> 'id'")"; I2="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T2'")"
PA_AFTER_SEND="$(Q "select quantity from products where id = '$PA'")"; PB_BEFORE="$(Q "select quantity from products where id = '$PB'")"
ok "$(CODE "select receive_stock_transfer_final('$T2', '$B', '$U', gen_random_uuid(), '[]')")" "P0080" "réception sans toutes les lignes : refusée (P0080)"
ok "$(CODE "select receive_stock_transfer_final('$T2', '$B', '$U', gen_random_uuid(), '[{\"item_id\":\"$I2\",\"quantity_received\":11,\"destination_product_id\":\"$PB\"}]')")" "P0076" "recevoir plus que l'envoyé : refusé (P0076)"
R2="$(Q "select receive_stock_transfer_final('$T2', '$B', '$U', gen_random_uuid(), '[{\"item_id\":\"$I2\",\"quantity_received\":8,\"destination_product_id\":\"$PB\",\"discrepancy_category\":\"breakage\",\"discrepancy_detail\":\"carton ecrase\"}]')")"
ok "$(echo "$R2" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(j.status+'/'+j.received+'/'+j.missing)")" "received/8/2" "réception avec écart : reçu 8, 2 manquants, transfert TERMINÉ (pas de réception partielle)"
ok "$(Q "select (select quantity from products where id = '$PB') - $PB_BEFORE || ':' || (select quantity from products where id = '$PA') - $PA_AFTER_SEND")" "8:0" "stock d'arrivée +8 seulement ; stock source inchangé à la réception"
ok "$(Q "select has_discrepancy || ':' || quantity_received || ':' || discrepancy_category || ':' || discrepancy_detail from stock_transfers t join stock_transfer_items i on i.stock_transfer_id = t.id where t.id = '$T2'")" "true:8:breakage:carton ecrase" "écart enregistré sur la ligne : cause et précision"
ok "$(Q "select type || ':' || quantity || ':' || shop_id || ':' || reason || ':' || coalesce(previous_qty::text, '-') from stock_movements where transfer_id = '$T2' and type = 'transit_loss'")" "transit_loss:2:$A:Transfert TR-$(date +%Y)-0006 : manquant à la réception:-" "mouvement « manquant » à la source, sans variation de stock"
ok "$(Q "select quantity_received || '/' || quantity_missing from stock_transfer_allocations where transfer_id = '$T2'")" "8/2" "allocation : 8 reçus, 2 manquants"

echo "── 6. Concurrence : deux réceptions en même temps"
P -d $DB -c "insert into product_batches (shop_id, product_id, quantity, initial_quantity, expiry_date, source, received_at) values ('$A', '$PA', 5, 5, shop_business_date('$A') + 30, 'restock', now())" >/dev/null
TC="$(Q "select create_stock_transfer('$A', '$B', '$U', 'concurrence', '[{\"product_id\":\"$PA\",\"quantity\":4}]', true) ->> 'id'")"; IC="$(Q "select id from stock_transfer_items where stock_transfer_id = '$TC'")"
PB_C="$(Q "select quantity from products where id = '$PB'")"
LINES="[{\"item_id\":\"$IC\",\"quantity_received\":4,\"destination_product_id\":\"$PB\"}]"
( P -d $DB -c "begin; select receive_stock_transfer_final('$TC', '$B', '$U', gen_random_uuid(), '$LINES'); select pg_sleep(3); commit;" > "$WORK/a.log" 2>&1 ) &
sleep 1
SECOND="$(CODE "select receive_stock_transfer_final('$TC', '$B', '$U', gen_random_uuid(), '$LINES')")"
wait
ok "$SECOND" "P0078" "la seconde réception attend la première puis reçoit « déjà réceptionné » (P0078)"
ok "$(Q "select quantity from products where id = '$PB'") " "$((PB_C + 4)) " "stock d'arrivée augmenté UNE seule fois (+4)"

echo "── 7. Annulation"
T4="$(Q "select create_stock_transfer('$A', '$B', '$U', 'annule', '[{\"product_id\":\"$PA\",\"quantity\":5}]', true) ->> 'id'")"
L3_MID="$(Q "select quantity from product_batches where id = '$L3'")"; PA_MID="$(Q "select quantity from products where id = '$PA'")"
Q "select cancel_stock_transfer('$T4', '$A', '$U')" >/dev/null
ok "$(Q "select status || ':' || (select revoked_at is not null from stock_transfer_tokens where transfer_id = '$T4') from stock_transfers where id = '$T4'")" "cancelled:true" "en transit, rien reçu : annulé, jeton révoqué"
ok "$(Q "select (select quantity from products where id = '$PA') - $PA_MID || ':' || (select quantity from product_batches where id = '$L3') - $L3_MID")" "5:5" "tout revient : produit +5 et lot source EXACT +5"
ok "$(CODE "select cancel_stock_transfer('$T2', '$A', '$U')")" "P0074" "transfert reçu : annulation refusée (P0074)"
ok "$(CODE "select receive_stock_transfer_final('$T4', '$B', '$U', gen_random_uuid(), '[]')")" "P0068" "transfert annulé : réception refusée (P0068)"

echo "── 8. Devises différentes, autre entreprise, même boutique"
T6="$(Q "select create_stock_transfer('$A', '$N', '$U', 'vers Kano', '[{\"product_id\":\"$PA\",\"quantity\":2}]', true) ->> 'id'")"; I6="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T6'")"
R6="$(Q "select receive_stock_transfer_final('$T6', '$N', '$U', gen_random_uuid(), '[{\"item_id\":\"$I6\",\"quantity_received\":2}]') -> 'created_products' -> 0 ->> 'needs_price'")"
ok "$R6" "true" "XAF → NGN, produit créé à l'arrivée : prix à fixer signalé"
DEST6="$(Q "select destination_product_id from stock_transfer_items where id = '$I6'")"
ok "$(Q "select is_active || ':' || selling_price || ':' || buying_price from products where id = '$DEST6'")" "false:0:0" "produit créé DÉSACTIVÉ, prix 0 (jamais vendu à 0 par erreur)"
ok "$(Q "select coalesce(buying_price::text, 'inconnu') || ':' || expiry_date from product_batches where product_id = '$DEST6'")" "inconnu:$(Q "select shop_business_date('$A') + 30")" "lot d'arrivée : coût INCONNU (pas de change inventé), péremption conservée"
ok "$(CODE "select receive_stock_transfer_final('$T6', '$B', '$U', gen_random_uuid(), '[]')")" "P0063" "réception par une AUTRE boutique que la destination : refusée (P0063)"
ok "$(CODE "select create_stock_transfer('$A', '$X', '$U', null, '[{\"product_id\":\"$PA\",\"quantity\":1}]', true)")" "P0061" "boutique d'une autre entreprise : refusé (P0061)"
ok "$(CODE "select create_stock_transfer('$A', '$A', '$U', null, '[{\"product_id\":\"$PA\",\"quantity\":1}]', true)")" "P0060" "même boutique : refusé (P0060)"
ok "$(CODE "select create_stock_transfer('$A', '$B', '$U', null, '[{\"product_id\":\"$PB\",\"quantity\":1}]', true)")" "P0066" "produit d'une autre boutique : refusé (P0066)"

echo "── 9. Brouillon, anciennes fonctions"
PA_D="$(Q "select quantity from products where id = '$PA'")"
T7="$(Q "select create_stock_transfer('$A', '$B', '$U', 'brouillon', '[{\"product_id\":\"$PA\",\"quantity\":1}]', false) ->> 'id'")"
ok "$(Q "select status || ':' || (select quantity from products where id = '$PA') || ':' || (select count(*) from stock_transfer_tokens where transfer_id = '$T7') from stock_transfers where id = '$T7'")" "draft:$PA_D:0" "brouillon : aucun stock touché, pas de jeton"
ok "$(CODE "select update_stock_transfer_draft('$T7', '$A', '$B', '$U', null, '[{\"product_id\":\"$PA\",\"quantity\":2}]', '2000-01-01')")" "P0065" "brouillon modifié entre-temps : refusé (P0065)"
ok "$(CODE "select receive_stock_transfer_final('$T7', '$B', '$U', gen_random_uuid(), '[]')")" "P0068" "brouillon : réception refusée (P0068)"
Q "select cancel_stock_transfer('$T7', '$A', '$U')" >/dev/null
ok "$(Q "select status from stock_transfers where id = '$T7'")" "cancelled" "brouillon annulé"
ok "$(Q "select send_stock_transfer('$A', '$B', '$U', 'ancienne app', '[{\"product_id\":\"$PA\",\"quantity\":1}]') ->> 'status'")" "sent" "ancienne fonction d'envoi (application d'avant) : passe par le nouveau modèle"
T8="$(Q "select id from stock_transfers where notes = 'ancienne app'")"; I8="$(Q "select id from stock_transfer_items where stock_transfer_id = '$T8'")"
Q "select receive_stock_transfer('$T8', '$B', '$U', '[{\"transfer_item_id\":\"$I8\",\"quantity_received\":0,\"destination_product_id\":\"$PB\",\"discrepancy_category\":\"theft\"}]')" >/dev/null
ok "$(Q "select status || ':' || has_discrepancy || ':' || (select discrepancy_category from stock_transfer_items where id = '$I8') from stock_transfers where id = '$T8'")" "received:true:theft" "ancienne réception avec manque : terminée avec écart (cause reprise)"

echo "── 10. Droits (navigateur)"
ok "$(Q "select count(*) from pg_proc p cross join (values ('anon'),('authenticated')) r(n) where p.proname in ('create_stock_transfer','update_stock_transfer_draft','send_stock_transfer_draft','receive_stock_transfer_final','cancel_stock_transfer','send_stock_transfer','receive_stock_transfer','_transfer_audit') and has_function_privilege(r.n, p.oid, 'EXECUTE')")" "0" "aucune fonction de transfert exécutable par le navigateur"
ok "$(Q "set role authenticated; select count(*) from public.stock_transfer_tokens" | grep -c 'permission denied')" "1" "jetons de QR illisibles par le navigateur"
ok "$(Q "set role authenticated; select count(*) from public.stock_transfer_allocations" | grep -c 'permission denied')" "1" "allocations (coûts) illisibles par le navigateur"
ok "$(Q "select has_column_privilege('authenticated', 'public.product_batches', 'origin_transfer_id', 'SELECT') and has_column_privilege('authenticated', 'public.product_batches', 'origin_untracked', 'SELECT') and not has_column_privilege('authenticated', 'public.product_batches', 'buying_price', 'SELECT')")" "t" "lots : colonnes d'origine lisibles, coût toujours réservé au serveur"

echo "── 11. Retour arrière sur la base UTILISÉE : refusé"
ok "$(P -d $DB -f "$REPO/supabase/rollbacks/188_transfers_workflow_rollback.sql" 2>&1 | grep -c 'Retour arrière refusé')" "1" "nouveau modèle utilisé : retour arrière refusé"
ok "$(Q "select count(*) from information_schema.tables where table_name = 'stock_transfer_allocations'")" "1" "refus : rien n'a été modifié"

echo "── 12. Retour arrière sur une base NEUVE (188 appliquée, jamais utilisée) : rend l'état d'avant"
setup r188f
ok "$(P -d $DB -f "$REPO/supabase/rollbacks/188_transfers_workflow_rollback.sql" >/dev/null 2>&1; echo $?)" "0" "retour arrière exécuté sans erreur"
ok "$(FN_MD5)" "$PROD_MD5" "fonctions d'envoi, de réception et d'annulation recréées À L'IDENTIQUE (empreintes de production)"
ok "$(Q "select count(*) from information_schema.columns where table_name = 'stock_movements' and column_name = 'batch_id'")" "1" "stock_movements.batch_id (179) CONSERVÉE"
ok "$(Q "select count(*) from information_schema.tables where table_name in ('stock_transfer_allocations', 'stock_transfer_tokens')")" "0" "tables de la 188 retirées"
ok "$(Q "select count(*) from information_schema.columns where (table_name = 'product_batches' and column_name like 'origin_t%') or (table_name = 'product_batches' and column_name = 'origin_untracked') or (table_name = 'stock_movements' and column_name = 'transfer_id') or (table_name = 'stock_transfers' and column_name in ('sent_at','sent_by','has_discrepancy','updated_at','receipt_key'))")" "0" "colonnes de la 188 retirées (batch_id exceptée)"
ok "$(Q "select string_agg(status, ',' order by notes) from stock_transfers")" "cancelled,sent,received" "anciens transferts intacts après le retour arrière"
ok "$(Q "select pg_get_constraintdef(oid) from pg_constraint where conname = 'stock_transfers_status_check'")" "CHECK ((status = ANY (ARRAY['sent'::text, 'received'::text, 'cancelled'::text])))" "statuts d'avant rétablis"

[ -n "${KEEP:-}" ] || P -d postgres -c "drop database if exists r188" -c "drop database if exists r188f" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"
[ "$fail" = 0 ]
