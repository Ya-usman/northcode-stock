#!/bin/bash
# Validation LOCALE de 216 (compte de démonstration vivant) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : marquage réservé aux comptes internes, créneaux de nuit ignorés, ventes générées par complete_sale dans le
# créneau, rythme plafonné, produits vendables seulement, boutique non démo intacte, relance sans doublon, réassort
# du matin (stock + mouvement + lot daté), charges récurrentes reprises sans le mois, aucun accès anonyme ou connecté,
# tâche planifiée, ré-exécution, retour arrière.
# complete_sale et les tables sont des doubles simplifiés ; sellable_stock est le texte EXACT de la migration 178.
# Usage (racine du dépôt) : bash supabase/drafts/216_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r216
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '([a-z_]+_check|permission denied|droit refusé)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

SELLABLE=$(sed -n '/^CREATE OR REPLACE FUNCTION public.sellable_stock/,/^\$\$;/p' supabase/migrations/178_expired_not_sellable.sql)
[ -n "$SELLABLE" ] || { echo "sellable_stock introuvable dans 178"; exit 2; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<SQL >/dev/null || { echo "schéma local impossible"; exit 2; }
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- pg_cron (double)
CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS
  \$f\$ INSERT INTO cron.job (jobname, schedule, command) VALUES (p_name, p_schedule, p_command) RETURNING jobid \$f\$;
CREATE FUNCTION cron.unschedule(p_id bigint) RETURNS boolean LANGUAGE sql AS \$f\$ DELETE FROM cron.job WHERE jobid = p_id RETURNING true \$f\$;
-- Tables (colonnes utilisées par 216)
CREATE TABLE entities (id uuid PRIMARY KEY, name text, is_internal boolean NOT NULL DEFAULT false);
CREATE TABLE shops (id uuid PRIMARY KEY, owner_id uuid, entity_id uuid REFERENCES entities, timezone text, deleted_at timestamptz);
CREATE TABLE suppliers (id uuid PRIMARY KEY, name text);
CREATE TABLE products (id uuid PRIMARY KEY, shop_id uuid, name text, selling_price numeric, buying_price numeric, quantity int,
  is_active boolean DEFAULT true, supplier_id uuid, track_serials boolean DEFAULT false, is_kit boolean DEFAULT false);
CREATE TABLE product_batches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, product_id uuid, supplier_id uuid,
  quantity int, initial_quantity int, buying_price numeric, expiry_date date, source text,
  received_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE stock_movements (id bigserial PRIMARY KEY, shop_id uuid, product_id uuid, type text, quantity int, reason text,
  performed_by uuid, previous_qty int, new_qty int, created_at timestamptz DEFAULT now());
CREATE TABLE sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, cashier_id uuid, customer_id uuid, subtotal numeric,
  discount numeric, total numeric, payment_method text, sale_status text DEFAULT 'active', client_request_id text UNIQUE, created_at timestamptz);
CREATE TABLE sale_items (id bigserial PRIMARY KEY, sale_id uuid, product_id uuid, quantity int, unit_price numeric);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, deleted_at timestamptz, merged_into uuid);
CREATE TABLE shop_members (shop_id uuid, user_id uuid, role text, is_active boolean, suspended_by_plan boolean DEFAULT false);
CREATE TABLE expenses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid, amount numeric, description text, date date,
  created_by uuid, category text, payment_method text, client_request_id text, UNIQUE (shop_id, client_request_id));
$SELLABLE
-- complete_sale (double) : refuse comme la vraie (paiements > total, produit d'une autre boutique), sort le stock
CREATE FUNCTION complete_sale(p_shop_id uuid, p_cashier_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text,
  p_subtotal numeric, p_discount numeric, p_tax numeric, p_total numeric, p_payment_method text, p_notes text, p_paystack_reference text,
  p_client_request_id text, p_items jsonb, p_payments jsonb, p_due_date date DEFAULT NULL, p_created_at timestamptz DEFAULT NULL,
  p_receipt_token text DEFAULT NULL, p_review_reason text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS \$f\$
DECLARE v_id uuid;
BEGIN
  IF (SELECT sum((e->>'amount')::numeric) FROM jsonb_array_elements(p_payments) e) > p_total + 0.01 THEN RAISE EXCEPTION 'paiements > total'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = (e->>'product_id')::uuid AND shop_id = p_shop_id)) THEN
    RAISE EXCEPTION 'Produit invalide pour cette boutique'; END IF;
  INSERT INTO sales (shop_id, cashier_id, customer_id, subtotal, discount, total, payment_method, client_request_id, created_at)
  VALUES (p_shop_id, p_cashier_id, p_customer_id, p_subtotal, p_discount, p_total, p_payment_method, p_client_request_id, coalesce(p_created_at, now()))
  RETURNING id INTO v_id;
  INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
  SELECT v_id, (e->>'product_id')::uuid, (e->>'quantity')::int, (e->>'unit_price')::numeric FROM jsonb_array_elements(p_items) e;
  UPDATE products p SET quantity = p.quantity - x.q
    FROM (SELECT (e->>'product_id')::uuid AS id, (e->>'quantity')::int AS q FROM jsonb_array_elements(p_items) e) x WHERE p.id = x.id;
  RETURN jsonb_build_object('sale', jsonb_build_object('id', v_id), 'already_existed', false);
END \$f\$;

-- Données : entreprise démo (interne), entreprise ordinaire ; Douala = UTC+1
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-00000000000d', 'Démo', true), ('e0000000-0000-0000-0000-00000000000c', 'Client', false);
INSERT INTO shops VALUES ('50000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000d', 'Africa/Douala', NULL),
                         ('50000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000c', 'Africa/Douala', NULL);
INSERT INTO suppliers VALUES ('f0000000-0000-0000-0000-000000000001', 'Ferme du Moungo');
INSERT INTO shop_members VALUES ('50000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-000000000001', 'cashier', true, false),
                                ('50000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-000000000002', 'stock_manager', true, false);
INSERT INTO customers (shop_id) SELECT '50000000-0000-0000-0000-00000000000d' FROM generate_series(1, 5);
-- Produits démo : 6 en stock, 1 épuisé, 1 dont tout le stock est PÉRIMÉ (non vendable), 1 inactif
INSERT INTO products (id, shop_id, name, selling_price, buying_price, quantity, supplier_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-00000000000d', 'Riz 5 kg', 6500, 5200, 40, NULL),
  ('d0000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-00000000000d', 'Huile 1 L', 1800, 1450, 40, NULL),
  ('d0000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-00000000000d', 'Savon', 400, 300, 40, NULL),
  ('d0000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-00000000000d', 'Eau 1,5 L', 500, 350, 60, NULL),
  ('d0000000-0000-0000-0000-000000000005', '50000000-0000-0000-0000-00000000000d', 'Sucre 1 kg', 900, 700, 40, NULL),
  ('d0000000-0000-0000-0000-000000000006', '50000000-0000-0000-0000-00000000000d', 'Lait', 1200, 900, 2, 'f0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-00000000000d', 'Pâtes', 600, 450, 0, NULL),
  ('d0000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-00000000000d', 'Yaourt', 300, 200, 10, NULL),
  ('d0000000-0000-0000-0000-000000000009', '50000000-0000-0000-0000-00000000000d', 'Ancien produit', 100, 50, 50, NULL);
UPDATE products SET is_active = false WHERE id = 'd0000000-0000-0000-0000-000000000009';
INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at) VALUES
  ('50000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000008', 10, 10, 200, '2026-11-01', 'restock', '2026-10-25 08:00+01'),
  ('50000000-0000-0000-0000-00000000000d', 'd0000000-0000-0000-0000-000000000006', 2, 24, 900, '2026-11-12', 'restock', '2026-11-07 08:00+01');
INSERT INTO products (id, shop_id, name, selling_price, buying_price, quantity) VALUES
  ('d0000000-0000-0000-0000-00000000000c', '50000000-0000-0000-0000-00000000000c', 'Produit client', 1000, 800, 50);
-- Historique : 80 ventes par jour sur 7 jours dans chaque boutique (le lait se vend bien : 3 par jour)
INSERT INTO sales (shop_id, total, client_request_id, created_at)
SELECT sh, 1000, 'hist-' || sh || '-' || g, TIMESTAMPTZ '2026-11-09 17:00+01' - g * interval '18 minutes'
  FROM generate_series(1, 560) g, (VALUES ('50000000-0000-0000-0000-00000000000d'::uuid), ('50000000-0000-0000-0000-00000000000c'::uuid)) v(sh);
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
SELECT id, 'd0000000-0000-0000-0000-000000000006', 1, 1200 FROM sales WHERE shop_id = '50000000-0000-0000-0000-00000000000d' ORDER BY created_at DESC LIMIT 42;
-- Charges : loyer du 9 octobre (mois écrit), transport du 2 novembre
INSERT INTO expenses (shop_id, amount, description, date, created_by, category, payment_method, client_request_id) VALUES
  ('50000000-0000-0000-0000-00000000000d', 150000, 'Loyer de la boutique, octobre', '2026-10-10', NULL, 'rent', 'bank_transfer', 'seed-1'),
  ('50000000-0000-0000-0000-00000000000d', 180000, 'Salaires d''octobre', '2026-10-10', NULL, 'salaries', 'bank_transfer', 'seed-2'),
  ('50000000-0000-0000-0000-00000000000d', 5000, 'Transport de marchandises', '2026-11-03', NULL, 'transport', 'cash', 'seed-3'),
  ('50000000-0000-0000-0000-00000000000c', 99000, 'Loyer client', '2026-10-10', NULL, 'rent', 'cash', 'seed-4');
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/216_demo_live.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "exécution n° $i"; done
ok "$(Q "SELECT count(*) || ' ' || max(schedule) FROM cron.job WHERE jobname = 'demo-live-sales'")" "1 */15 * * * *" "une seule tâche planifiée, toutes les 15 minutes"

echo "── 2. Marquage réservé aux comptes internes"
ok "$(ERR "UPDATE entities SET is_demo = true WHERE name = 'Client'")" "entities_demo_internal_check" "entreprise ordinaire marquée « démo » : refusé"
ok "$(Q "UPDATE entities SET is_demo = true WHERE id = 'e0000000-0000-0000-0000-00000000000d' RETURNING is_demo")" "t" "entreprise interne marquée « démo »"

echo "── 3. Aucun accès des comptes connectés ou anonymes"
for r in anon authenticated; do
  ok "$(P -d $DB -c "SET ROLE $r; SELECT public.demo_live_tick()" 2>&1 | grep -oE 'permission denied|droit refusé' | head -1)" "permission denied" "$r ne peut pas lancer la génération"
  ok "$(P -d $DB -c "SET ROLE $r; SELECT count(*) FROM public.demo_live_runs" 2>&1 | grep -oE 'permission denied|droit refusé' | head -1)" "permission denied" "$r ne lit pas le journal"
done

echo "── 4. Nuit : rien"
ok "$(Q "SELECT jsonb_array_length(demo_live_tick(TIMESTAMPTZ '2026-11-09 02:30+01') -> 'shops')")" "0" "créneau de 2 h 15 : aucune boutique traitée"
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%'")" "0" "aucune vente la nuit"

echo "── 5. Créneau de 17 h (lundi 9 nov.) : ventes générées"
Q "SELECT setseed(0.42)" >/dev/null
R=$(Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-09 17:15+01')")
N=$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%'")
ok "$( [ "$N" -ge 1 ] && [ "$N" -le 12 ] && echo dans || echo "hors ($N)")" "dans" "1 à 12 ventes générées ($N)"
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%' AND NOT (created_at >= '2026-11-09 17:00+01' AND created_at < '2026-11-09 17:15+01')")" "0" "toutes datées dans le créneau 17 h 00 → 17 h 15"
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%' AND shop_id <> '50000000-0000-0000-0000-00000000000d'")" "0" "boutique ordinaire : aucune vente générée"
ok "$(Q "SELECT count(*) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.client_request_id LIKE 'demo-live-%' AND si.product_id IN ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000009')")" "0" "jamais d'épuisé, de périmé ni d'inactif"
ok "$(Q "SELECT count(*) FROM products WHERE quantity < 0")" "0" "aucun stock négatif"
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%' AND (total <> subtotal - discount OR total <= 0)")" "0" "totaux cohérents"
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%' AND cashier_id NOT IN ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000d')")" "0" "vendeur : caissier de la boutique (jamais le gestionnaire de stock)"
ok "$(Q "SELECT sales || '/' || errors FROM demo_live_runs WHERE slot_start = '2026-11-09 17:00+01'")" "$N/0" "journal du créneau : $N ventes, 0 erreur"

echo "── 6. Relance du même créneau : aucun doublon"
Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-09 17:15+01')" >/dev/null
Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-09 17:29+01')" >/dev/null
ok "$(Q "SELECT count(*) FROM sales WHERE client_request_id LIKE 'demo-live-%'")" "$N" "toujours $N ventes"

echo "── 7. Plafond par créneau"
P -d $DB -c "INSERT INTO sales (shop_id, total, client_request_id, created_at) SELECT '50000000-0000-0000-0000-00000000000d', 1000, 'flood-' || g, TIMESTAMPTZ '2026-11-09 17:00+01' - g * interval '1 minute' FROM generate_series(1, 3000) g" >/dev/null
UPDATE_STOCK=$(P -d $DB -c "UPDATE products SET quantity = 500 WHERE shop_id = '50000000-0000-0000-0000-00000000000d' AND id NOT IN ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000009')")
Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-09 18:15+01')" >/dev/null
ok "$(Q "SELECT (sales <= 4)::text FROM demo_live_runs WHERE slot_start = '2026-11-09 18:00+01'")" "true" "rythme plafonné (80 ventes par jour au plus : 4 par créneau)"

echo "── 8. Matin (mardi 10 nov., créneau de 7 h) : réassort et charges"
P -d $DB -c "UPDATE products SET quantity = 2 WHERE id = 'd0000000-0000-0000-0000-000000000006'" >/dev/null
P -d $DB -c "UPDATE product_batches SET quantity = 2 WHERE product_id = 'd0000000-0000-0000-0000-000000000006'" >/dev/null
P -d $DB -c "UPDATE products SET quantity = 500 WHERE id = 'd0000000-0000-0000-0000-000000000001'" >/dev/null
Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-10 07:15+01')" >/dev/null
ok "$(Q "SELECT count(*) FROM stock_movements WHERE product_id = 'd0000000-0000-0000-0000-000000000006' AND type = 'in'")" "1" "lait presque épuisé : un réassort"
ok "$(Q "SELECT reason FROM stock_movements WHERE product_id = 'd0000000-0000-0000-0000-000000000006'")" "Restock from Ferme du Moungo" "mouvement au nom du fournisseur, comme l'application"
ok "$(Q "SELECT (b.quantity = m.quantity AND m.previous_qty = 2 AND m.new_qty = m.previous_qty + m.quantity AND b.source = 'restock')::text FROM stock_movements m JOIN product_batches b ON b.product_id = m.product_id AND b.received_at = m.created_at WHERE m.product_id = 'd0000000-0000-0000-0000-000000000006'")" "true" "un lot de la quantité ajoutée, mouvement 2 → 2 + ajout"
ok "$(Q "SELECT count(*) FROM stock_movements WHERE product_id IN ('d0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000008') AND type = 'in'")" "2" "produit épuisé et produit tout périmé : réassortis"
ok "$(Q "SELECT expiry_date FROM product_batches WHERE product_id = 'd0000000-0000-0000-0000-000000000008' ORDER BY created_at DESC LIMIT 1")" "2026-11-17" "yaourt : nouveau lot frais (durée de vie 7 jours)"
ok "$(Q "SELECT b.expiry_date FROM product_batches b WHERE product_id = 'd0000000-0000-0000-0000-000000000006' ORDER BY created_at DESC LIMIT 1")" "2026-11-15" "durée de vie reprise du lot précédent (5 jours)"
ok "$(Q "SELECT count(*) FROM stock_movements WHERE product_id = 'd0000000-0000-0000-0000-000000000001'")" "0" "riz bien stocké : pas de réassort"
ok "$(Q "SELECT count(*) FROM stock_movements WHERE product_id IN ('d0000000-0000-0000-0000-000000000009', 'd0000000-0000-0000-0000-00000000000c')")" "0" "ni produit inactif ni boutique ordinaire"
ok "$(Q "SELECT string_agg(description || ' ' || date, ' | ' ORDER BY category) FROM expenses WHERE client_request_id LIKE 'demo-live-exp-%'")" "Loyer de la boutique 2026-11-10 | Salaires 2026-11-10 | Transport de marchandises 2026-11-10" "loyer et salaires d'un mois avant, transport d'une semaine avant, sans le mois"
ok "$(Q "SELECT count(*) FROM expenses WHERE shop_id = '50000000-0000-0000-0000-00000000000c'")" "1" "charges de la boutique ordinaire inchangées"
Q "SELECT demo_live_tick(TIMESTAMPTZ '2026-11-10 07:15+01')" >/dev/null
ok "$(Q "SELECT (SELECT count(*) FROM expenses WHERE client_request_id LIKE 'demo-live-exp-%') || '/' || (SELECT count(*) FROM stock_movements)")" "3/3" "relance du matin : ni charge ni réassort en double"

echo "── 9. Entreprise qui n'est plus « démo » : rien"
P -d $DB -c "UPDATE entities SET is_demo = false" >/dev/null
ok "$(Q "SELECT jsonb_array_length(demo_live_tick(TIMESTAMPTZ '2026-11-10 12:15+01') -> 'shops')")" "0" "aucune boutique traitée"

echo "── 10. Retour arrière"
P -d $DB -f supabase/rollbacks/216_demo_live_rollback.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "retour arrière exécuté"
ok "$(Q "SELECT (SELECT count(*) FROM cron.job) || '/' || (SELECT count(*) FROM pg_proc WHERE proname = 'demo_live_tick') || '/' || (SELECT count(*) FROM information_schema.columns WHERE table_name = 'entities' AND column_name = 'is_demo') || '/' || coalesce(to_regclass('public.demo_live_runs')::text, 'absente')")" "0/0/0/absente" "tâche, fonction, colonne et journal retirés"
ok "$(Q "SELECT (count(*) > 0)::text FROM sales WHERE client_request_id LIKE 'demo-live-%'")" "true" "ventes générées conservées"
P -d $DB -f supabase/migrations/216_demo_live.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "ré-installation après retour arrière"

[ -n "${KEEP:-}" ] || P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
