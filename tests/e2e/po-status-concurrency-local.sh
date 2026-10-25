#!/bin/bash
# Bons de commande — concurrence « annulation conditionnée au statut » contre une réception en cours.
# Base PostgreSQL LOCALE jetable UNIQUEMENT (jamais la production) : crée puis supprime la base po_conc_test.
# Usage : PSQL_BIN="/c/Program Files/PostgreSQL/18/bin" PGPORT=55432 bash tests/e2e/po-status-concurrency-local.sh
set -u
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST="${PGHOST:-localhost}"
case "$HOST" in localhost|127.0.0.1) ;; *) echo "REFUS : base locale uniquement (PGHOST=$HOST)"; exit 2 ;; esac
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
pass=0; fail=0; ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3 (attendu « $2 », obtenu « $1 »)"; fi; }

P -d postgres -c "drop database if exists po_conc_test" -c "create database po_conc_test" >/dev/null || exit 2
DB() { P -d po_conc_test "$@"; }
setup() {
DB <<'SQL'
drop table if exists purchase_orders, products, product_batches, suppliers, stock_movements;
create table purchase_orders (id uuid primary key, shop_id uuid not null, status text not null, cancelled_by uuid, received_at timestamptz, updated_at timestamptz);
create table products (id uuid primary key, quantity int not null);
create table product_batches (id serial primary key, product_id uuid, quantity int, source text);
create table suppliers (id uuid primary key, total_owed numeric not null);
create table stock_movements (id serial primary key, product_id uuid, quantity int, reason text);
insert into purchase_orders values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'sent', null, null, null);
insert into products values ('00000000-0000-0000-0000-0000000000c1', 10);
insert into suppliers values ('00000000-0000-0000-0000-0000000000d1', 0);
SQL
}
# Instruction envoyée par PATCH (PostgREST : UPDATE … WHERE id AND shop_id AND status = <statut lu> RETURNING …)
CANCEL="with u as (update purchase_orders set status='cancelled', cancelled_by='00000000-0000-0000-0000-0000000000e1', updated_at=now()
  where id='00000000-0000-0000-0000-0000000000a1' and shop_id='00000000-0000-0000-0000-0000000000b1' and status='sent' returning id)
  select count(*) from u"
# Réception : même ordre de verrouillage que apply_purchase_order_receipt (FOR UPDATE sur le bon d'abord)
RECEIPT="begin;
select status from purchase_orders where id='00000000-0000-0000-0000-0000000000a1' for update;
update products set quantity = quantity + 5 where id='00000000-0000-0000-0000-0000000000c1';
insert into stock_movements (product_id, quantity, reason) values ('00000000-0000-0000-0000-0000000000c1', 5, 'Reception BC-TEST');
insert into product_batches (product_id, quantity, source) values ('00000000-0000-0000-0000-0000000000c1', 5, 'purchase_order');
update suppliers set total_owed = total_owed + 1000 where id='00000000-0000-0000-0000-0000000000d1';
update purchase_orders set status='received', received_at=now(), updated_at=now() where id='00000000-0000-0000-0000-0000000000a1';
select pg_sleep(2);
commit;"

# Scénario 1 : la réception tient le verrou, l'annulation arrive pendant ce temps
setup
DB -c "$RECEIPT" >/dev/null & RPID=$!
sleep 0.7
t0=$(date +%s%N); n=$(DB -c "$CANCEL"); t1=$(date +%s%N); wait $RPID
ms=$(( (t1 - t0) / 1000000 ))
ok "$n" "0" "annulation pendant une réception : 0 ligne modifiée"
ok "$([ $ms -ge 800 ] && echo attendu || echo "sans attente ($ms ms)")" "attendu" "l'annulation a attendu la fin de la réception ($ms ms)"
ok "$(DB -c "select status||'/'||coalesce(cancelled_by::text,'none')||'/'||(received_at is not null) from purchase_orders")" "received/none/true" "le bon reste « received », jamais annulé"
ok "$(DB -c "select quantity from products")" "15" "stock : seulement la réception (+5)"
ok "$(DB -c "select count(*)||'/'||sum(quantity) from product_batches")" "1/5" "lots : seulement celui de la réception"
ok "$(DB -c "select total_owed from suppliers")" "1000" "dette : seulement la réception"
ok "$(DB -c "select count(*) from stock_movements")" "1" "mouvements : seulement la réception"

# Scénario 2 : l'annulation passe d'abord (statut encore « sent ») → la réception trouve « cancelled »
setup
ok "$(DB -c "$CANCEL")" "1" "annulation d'un bon encore « sent » : 1 ligne"
ok "$(DB -c "select status from purchase_orders where id='00000000-0000-0000-0000-0000000000a1' for update")" "cancelled" "la réception relit « cancelled » (apply_purchase_order_receipt refuse tout statut hors draft / sent)"
ok "$(DB -c "$CANCEL")" "0" "seconde annulation (écran périmé) : 0 ligne"

# Scénario 3 : ancienne écriture (WHERE id seulement) — montre le défaut corrigé
setup
DB -c "$RECEIPT" >/dev/null & RPID=$!
sleep 0.7
n=$(DB -c "with u as (update purchase_orders set status='cancelled' where id='00000000-0000-0000-0000-0000000000a1' and shop_id='00000000-0000-0000-0000-0000000000b1' returning id) select count(*) from u"); wait $RPID
ok "$n/$(DB -c "select status from purchase_orders")/$(DB -c "select quantity from products")" "1/cancelled/15" "témoin : sans condition de statut, le bon reçu devenait « cancelled » avec le stock +5 en place"

P -d postgres -c "drop database po_conc_test" >/dev/null
echo "$pass réussis, $fail échec(s)"
[ $fail -eq 0 ]
