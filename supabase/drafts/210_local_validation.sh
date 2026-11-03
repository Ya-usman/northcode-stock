#!/bin/bash
# Validation LOCALE de 210 (options payantes) — base PostgreSQL jetable UNIQUEMENT.
# Vérifie : colonnes et valeurs par défaut (aucune entreprise existante ne reçoit d'option), plafonds (20 employés,
# 2 boutiques en plus), retrait programmé, paiements « option » (quantité et fin de période obligatoires), écriture
# refusée aux comptes connectés, ré-exécution, retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/210_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r210
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '([a-z_]+_check|permission denied|réservée au serveur)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
E=e0000000-0000-0000-0000-000000000001
PI="INSERT INTO payment_intents (reference, gateway, shop_id, plan, billing_period, currency, amount, amount_due"

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
CREATE TABLE entities (id uuid primary key, name text, plan text, plan_expires_at timestamptz);
-- payment_intents comme en production (contraintes utiles de la 204)
CREATE TABLE payment_intents (id serial primary key, reference text UNIQUE, gateway text, shop_id uuid, plan text CHECK (plan IN ('starter','pro','business')),
  billing_period text, currency text, amount numeric CHECK (amount > 0), amount_due numeric, status text DEFAULT 'pending');
CREATE FUNCTION is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE v_role text;
BEGIN
  v_role := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END $$;
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT request_is_restricted() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
CREATE TRIGGER trg_entities_guard BEFORE INSERT OR UPDATE OR DELETE ON entities FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns();
CREATE TRIGGER trg_payment_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_intents FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns();
INSERT INTO entities VALUES ('e0000000-0000-0000-0000-000000000001', 'SOFAR', 'pro', now() + interval '20 days');
INSERT INTO payment_intents (reference, gateway, shop_id, plan, billing_period, currency, amount, amount_due)
  VALUES ('SS-ancien-paiement', 'flutterwave', 'a0000000-0000-0000-0000-000000000001', 'pro', 'monthly', 'XOF', 10000, 10000);
GRANT ALL ON entities, payment_intents TO authenticated;
GRANT USAGE ON SEQUENCE payment_intents_id_seq TO authenticated;
SQL

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/210_addons.sql >/dev/null 2>&1 && RES=ok || RES=ko; ok "$RES" "ok" "exécution n° $i"; done

echo "── 2. Existant inchangé"
ok "$(Q "SELECT addon_seats || '/' || addon_shops || '/' || coalesce(addon_seats_renew::text, 'idem') FROM entities")" "0/0/idem" "entreprise existante : aucune option, renouvellement « le même »"
ok "$(Q "SELECT kind || '/' || addon_seats || '/' || addon_shops FROM payment_intents WHERE reference = 'SS-ancien-paiement'")" "plan/0/0" "ancien paiement : formule, sans option"

echo "── 3. Plafonds"
ok "$(Q "UPDATE entities SET addon_seats = 20, addon_shops = 2 WHERE id = '$E' RETURNING addon_seats || '/' || addon_shops")" "20/2" "20 employés et 2 boutiques en plus acceptés"
ok "$(ERR "UPDATE entities SET addon_seats = 21 WHERE id = '$E'")" "entities_addons_check" "21 employés en plus refusés"
ok "$(ERR "UPDATE entities SET addon_shops = 3 WHERE id = '$E'")" "entities_addons_check" "3 boutiques en plus refusées (au-delà : sur mesure)"
ok "$(ERR "UPDATE entities SET addon_seats = -1 WHERE id = '$E'")" "entities_addons_check" "quantité négative refusée"
ok "$(Q "UPDATE entities SET addon_seats_renew = 5, addon_shops_renew = 0 WHERE id = '$E' RETURNING addon_seats_renew || '/' || addon_shops_renew")" "5/0" "retrait programmé au renouvellement"
ok "$(ERR "UPDATE entities SET addon_shops_renew = 3 WHERE id = '$E'")" "entities_addons_check" "renouvellement au-delà du plafond refusé"

echo "── 4. Paiements « option »"
ok "$(Q "$PI, kind, addon_seats, period_end) VALUES ('SS-option-1', 'flutterwave', '$E', 'pro', 'monthly', 'XOF', 900, 900, 'addon', 1, now() + interval '18 days') RETURNING kind")" "addon" "achat d'un employé au prorata"
ok "$(ERR "$PI, kind) VALUES ('SS-option-2', 'flutterwave', '$E', 'pro', 'monthly', 'XOF', 900, 900, 'addon')")" "payment_intents_addons_check" "option sans quantité refusée"
ok "$(ERR "$PI, kind, addon_seats) VALUES ('SS-option-3', 'flutterwave', '$E', 'pro', 'monthly', 'XOF', 900, 900, 'addon', 1)")" "payment_intents_addons_check" "option sans fin de période refusée"
ok "$(ERR "$PI, kind) VALUES ('SS-option-4', 'flutterwave', '$E', 'pro', 'monthly', 'XOF', 900, 900, 'cadeau')")" "payment_intents_addons_check" "type inconnu refusé"
ok "$(Q "$PI, addon_seats, addon_shops) VALUES ('SS-formule-1', 'flutterwave', '$E', 'starter', 'annual', 'XOF', 100000, 100000, 2, 1) RETURNING kind || '/' || addon_seats || '/' || addon_shops")" "plan/2/1" "formule avec options du renouvellement"

echo "── 5. Accès"
JWT="SET request.jwt.claims = '{\"role\":\"authenticated\"}';"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT UPDATE entities SET addon_seats = 5 WHERE id = '$E'" 2>&1 | grep -oE 'réservée au serveur' | head -1)" "réservée au serveur" "compte connecté : options de l'entreprise non modifiables"
ok "$(P -d $DB -c "SET ROLE authenticated; $JWT $PI, kind, addon_seats, period_end) VALUES ('SS-pirate', 'flutterwave', '$E', 'pro', 'monthly', 'XOF', 1, 1, 'addon', 20, now())" 2>&1 | grep -oE 'réservée au serveur' | head -1)" "réservée au serveur" "compte connecté : paiement préparé impossible"

echo "── 6. Retour arrière"
P -d $DB -f supabase/rollbacks/210_addons_rollback.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "retour arrière exécuté"
ok "$(Q "SELECT count(*) FROM information_schema.columns WHERE column_name LIKE 'addon_%' OR (table_name = 'payment_intents' AND column_name IN ('kind', 'period_end'))")" "0" "colonnes retirées"
P -d $DB -f supabase/migrations/210_addons.sql >/dev/null 2>&1 && RES=ok || RES=ko
ok "$RES" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
