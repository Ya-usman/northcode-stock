#!/bin/sh
# 179 — validation complète sur une base PostgreSQL LOCALE jetable — BROUILLON DE TEST, jamais la production.
# Prérequis : un serveur PostgreSQL local de test, par exemple :
#   initdb -D <dossier temporaire> -U postgres -A trust -E UTF8 --locale=C ; pg_ctl -D <dossier> -o "-p 55432" start
# Lancer depuis la racine du dépôt :  sh supabase/drafts/179_batch_treatments_local_validation.sh
# Crée et supprime les bases t179, t179fk, t179h et t179r sur CE serveur local uniquement.
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"; PGPORT="${PGPORT:-55432}"
P="$PGBIN/psql.exe"; [ -x "$P" ] || P="$PGBIN/psql"
export PGCLIENTENCODING=UTF8   # SQL accentué : toujours par fichier ou entrée standard, jamais en argument -c
D="supabase/drafts"; M="supabase/migrations/179_batch_treatments.sql"; R="$D/179_batch_treatments_rollback.sql"
[ -f "$M" ] || { echo "Lancer depuis la racine du dépôt"; exit 1; }
fresh() { "$P" -h localhost -p "$PGPORT" -U postgres -q -c "drop database if exists $1" -c "create database $1" 2>/dev/null
          "$P" -h localhost -p "$PGPORT" -U postgres -d "$1" -q -v ON_ERROR_STOP=1 -f "$D/179_batch_treatments_test_stub.sql" || exit 1; }
q() { db="$1"; shift; "$P" -h localhost -p "$PGPORT" -U postgres -d "$db" -tA -q "$@"; }

echo "═══ 1. Suite principale"
fresh t179
q t179 -v ON_ERROR_STOP=1 --single-transaction -f "$M" && echo "migration : OK" || exit 1
q t179 -v ON_ERROR_STOP=1 -f "$D/179_batch_treatments_tests.sql" 2>&1 | grep -E "^ÉCHEC|réussis|ERROR"

echo "═══ 2. Banc des clés lot / produit / boutique"
fresh t179fk
q t179fk -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null || exit 1
q t179fk -v ON_ERROR_STOP=1 -f "$D/179_batch_treatments_fk_tests.sql" 2>&1 | grep -E "^ÉCHEC|réussis|ERROR|ordre réel"

echo "═══ 3. Retour arrière"
# a) base AVEC historique (2 traitements, 1 photo + son fichier, 2 mouvements liés) : refus attendu, rien retiré
fresh t179h
q t179h -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null || exit 1
sed -n '/═════ pg179-fk-setup.sql ═════/,/═════ pg179-fk-direct.sql ═════/p' "$D/179_batch_treatments_fk_tests.sql" | q t179h -v ON_ERROR_STOP=1 -f - >/dev/null || exit 1
q t179h --single-transaction -f "$R" 2>&1 | grep -E "ERROR" | head -1
q t179h <<'SQL'
select 'après refus : ' || CASE WHEN (select count(*) from pg_tables where tablename in ('batch_treatments','batch_treatment_photos')) = 2
  AND exists (select 1 from pg_proc where proname = 'delete_shops') THEN 'rien retiré (OK)' ELSE 'ÉCHEC : quelque chose a été retiré' END;
SQL
# b) après la suite principale (boutique supprimée par delete_shops → plus aucun historique) : retour arrière accepté
q t179 -v ON_ERROR_STOP=1 --single-transaction -f "$R" >/dev/null && echo "après suite principale (historique parti avec la boutique) : retour arrière accepté" || echo "ÉCHEC retour arrière après suite principale"
# c) base neuve : aller, retour (état d'origine exact), aller
fresh t179r
BEFORE=$(q t179r -c "select confdeltype::text||condeferrable::text||condeferred::text from pg_constraint where conname = 'sale_item_batches_batch_id_fkey'")
q t179r -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null && \
q t179r -v ON_ERROR_STOP=1 --single-transaction -f "$R" >/dev/null && echo "base neuve : migration puis retour arrière : OK" || echo "ÉCHEC retour arrière"
q t179r <<'SQL'
select 'restes 179 : ' || (select count(*) from pg_tables where tablename in ('batch_treatments','batch_treatment_photos'))
  + (select count(*) from information_schema.columns where table_name = 'stock_movements' and column_name in ('batch_id','batch_treatment_id'))
  + (select count(*) from pg_proc where proname in ('treat_batch','resolve_unallocated','register_batch_treatment_photo','unallocated_candidates','remove_review_reason','delete_shops',
       'batch_history_immutable','batch_treatment_photos_immutable','batch_treatments_insert_guard','batch_treatment_photos_insert_guard','product_batches_expiry_guard'))
  + (select count(*) from pg_trigger where not tgisinternal) + (select count(*) from storage.buckets where id = 'batch-treatment-photos');
select 'clé allocation : ' || (select 'SET NULL=' || (confdeltype = 'n') || ', différable=' || condeferrable from pg_constraint where conname = 'sale_item_batches_batch_id_fkey');
select 'adjust_batch_quantity serveur : ' || has_function_privilege('service_role', 'public.adjust_batch_quantity(uuid,uuid,integer,text,uuid)', 'execute');
select 'md5 delete_product_batch 117 : ' || ((select md5(prosrc) from pg_proc where proname = 'delete_product_batch') = '8ad155aae3901f1125b1ace5e138a0dd');
SQL
AFTER=$(q t179r -c "select confdeltype::text||condeferrable::text||condeferred::text from pg_constraint where conname = 'sale_item_batches_batch_id_fkey'")
[ "$BEFORE" = "$AFTER" ] && echo "clé identique à l'état d'origine : oui" || echo "ÉCHEC clé différente de l'état d'origine ($BEFORE / $AFTER)"
q t179r -v ON_ERROR_STOP=1 --single-transaction -f "$M" >/dev/null && echo "ré-application après retour arrière : OK" || echo "ÉCHEC ré-application"
