#!/bin/bash
# Validation LOCALE de 207 (nouveaux pays et monnaies) — base PostgreSQL jetable UNIQUEMENT.
# Fonctions de PRODUCTION installées d'abord (drafts/207_prod) : pour CHAQUE pays existant, monnaie et fuseaux
# identiques avant / après ; nouveaux pays : monnaie et fuseaux attendus ; monnaies nouvelles acceptées, inconnues
# refusées ; ré-exécution ; retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/207_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r207
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '[a-z_]+_currency_supported' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
OLD="'NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD','CZK','DKK','HUF','PLN','RON','SEK'"
P -d $DB -c "CREATE TABLE shops (id serial primary key, currency text, CONSTRAINT shops_currency_supported CHECK (currency IN ($OLD)));
CREATE TABLE agent_commissions (id serial primary key, currency text, CONSTRAINT agent_commissions_currency_supported CHECK (currency IN ($OLD)));
CREATE TABLE entities (id serial primary key, consolidation_currency text, CONSTRAINT entities_consolidation_currency_supported CHECK (consolidation_currency IN ($OLD)));
INSERT INTO shops (currency) VALUES ('NGN'), ('XOF'), ('EUR'), ('PLN');" >/dev/null
for f in currency_code_for_country country_default_time_zone country_time_zones; do P -d $DB -f supabase/drafts/207_prod/$f.sql >/dev/null; done
CODES="NG CM CI ML NE SN BJ TG GH BF GN GW GM SL LR CV MR CD CG GA GQ CF TD US CA DE AT BE BG HR CY DK ES EE FI FR GR HU IE IT LV LT LU MT NL PL PT CZ RO SK SI SE XX"
snap() { for c in $CODES; do echo "$c=$(Q "SELECT coalesce(currency_code_for_country('$c'),'aucun') || '|' || coalesce(country_default_time_zone('$c'),'aucun') || '|' || coalesce(array_to_string(country_time_zones('$c'),','),'aucun')")"; done; }
BEFORE=$(snap)

echo "── 1. Migration (2 fois : ré-exécutable)"
for i in 1 2; do P -d $DB -f supabase/migrations/207_new_countries.sql >/dev/null 2>&1 && R=ok || R=ko; ok "$R" "ok" "exécution n° $i"; done

echo "── 2. Pays existants inchangés"
AFTER=$(snap)
DIFF=$(diff <(echo "$BEFORE") <(echo "$AFTER") | grep "^[<>]"); echo "$DIFF" | head -6; ok "$(echo "$DIFF" | grep -c .)" "0" "53 pays existants (et un code inconnu) : monnaie et fuseaux identiques"

echo "── 3. Nouveaux pays"
ok "$(Q "SELECT currency_code_for_country('KE') || ',' || currency_code_for_country('IN') || ',' || currency_code_for_country('BR') || ',' || currency_code_for_country('EC') || ',' || currency_code_for_country('AR') || ',' || currency_code_for_country('CH')")" "KES,INR,BRL,USD,ARS,CHF" "monnaies : Kenya KES, Inde INR, Brésil BRL, Équateur USD, Argentine ARS (facturée en dollars par l'application), Suisse CHF"
ok "$(Q "SELECT currency_code_for_country('GB') || ',' || country_default_time_zone('GB')")" "GBP,Europe/London" "Royaume-Uni, nouveau pays : livre sterling (avant : naira par défaut), fuseau inchangé"
ok "$(Q "SELECT country_default_time_zone('KE') || ',' || country_default_time_zone('IN') || ',' || country_default_time_zone('CH')")" "Africa/Nairobi,Asia/Kolkata,Europe/Zurich" "fuseaux uniques"
ok "$(Q "SELECT coalesce(country_default_time_zone('BR'),'aucun') || ',' || array_length(country_time_zones('BR'),1) || ',' || (country_time_zones('BR'))[1]")" "aucun,16,America/Sao_Paulo" "Brésil : 16 fuseaux, aucun imposé par défaut"
ok "$(Q "SELECT array_to_string(country_time_zones('KE'),',')")" "Africa/Nairobi" "Kenya : un seul fuseau autorisé"

echo "── 4. Monnaies acceptées"
ok "$(Q "INSERT INTO shops (currency) VALUES ('KES'), ('INR'), ('BRL'), ('GBP'), ('CHF'), ('TND') RETURNING 'ok'" )" "ok" "boutiques en KES, INR, BRL, GBP, CHF, TND acceptées"
ok "$(Q "INSERT INTO agent_commissions (currency) VALUES ('MXN') RETURNING 'ok'")" "ok" "commission en MXN acceptée"
ok "$(Q "INSERT INTO entities (consolidation_currency) VALUES ('JPY') RETURNING 'ok'")" "ok" "consolidation en JPY acceptée"
ok "$(ERR "INSERT INTO shops (currency) VALUES ('XYZ')")" "shops_currency_supported" "monnaie inconnue refusée (boutique)"
ok "$(ERR "INSERT INTO agent_commissions (currency) VALUES ('kes')")" "agent_commissions_currency_supported" "code en minuscules refusé (commission)"

echo "── 5. Retour arrière"
P -d $DB -c "DELETE FROM shops WHERE currency NOT IN ($OLD); DELETE FROM agent_commissions; DELETE FROM entities;" >/dev/null
P -d $DB -f supabase/rollbacks/207_new_countries_rollback.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "retour arrière exécuté"
ok "$(diff <(echo "$BEFORE") <(snap) | grep -c '^[<>]')" "0" "fonctions revenues à la version de production"
ok "$(ERR "INSERT INTO shops (currency) VALUES ('KES')")" "shops_currency_supported" "KES de nouveau refusé"
P -d $DB -f supabase/migrations/207_new_countries.sql >/dev/null 2>&1 && R=ok || R=ko
ok "$R" "ok" "migration rejouée après retour arrière"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]
