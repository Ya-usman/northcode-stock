#!/bin/bash
# Lance des tests navigateur sur le serveur LOCAL, l'un après l'autre (jamais en parallèle).
# Usage : bash tests/e2e/run-local.sh [test ...]   (sans argument : suites courantes, sans écriture réelle)
# Les journaux vont dans tests/e2e/out/ ; le résumé dans tests/e2e/out/resume.log.
# Exclus (écritures réelles sur Boutique Alpha, à lancer seulement sur accord) : run-write.sh — stock-reserved,
# product-detail, inventory-v2 ; lot2-scope figure dans les deux (partie A lecture seule, partie B en mode écriture).
cd "$(dirname "$0")"
# Serveur local : CAPTURE_BASE déjà fourni, sinon le port 3000
export CAPTURE_BASE="${CAPTURE_BASE:-http://localhost:3000}"
mkdir -p out
DEFAULT="lot1-pos-settings lot1-pos-switch-safe lot2-scope inventory-v2-visual lot3-scope lot4-scope lot5-security d1-consolidation company-savebar stock-adoption initial-context fix-context stock-nav stock-overview stock-table stock-columns stock-drawers stock-pipeline stock-expired movements-ux products-ux overview-finish lots-ux filters-products open-row help-page po-email-ux stock-near-rupture stock-flow stock-valuation hausa-dates-screens packaging-ux inventory-cycle-ux transfer-receive-context location-ux serials-ux kits-ux bulk-add-ux back-and-lots-ux api-new-product product-form-ux pos-simple-ux wholesale-ux sale-measures-ux products-simple2-ux plan-lock-ux history-lock-ux addons-ux limit-reached-ux custom-plan-ux plan-change-ux trial-ux landing-pricing-ux roles-labels-ux"
TESTS="${*:-$DEFAULT}"
: > out/resume.log
node lib/vitrine-fixture.js >> out/resume.log 2>&1 || { echo "repères vitrine introuvables"; exit 1; }
for t in $TESTS; do
  extra=""
  [ "$t" = "stock-expired" ] && extra="PIN_SHOP=7313d74e-43dd-4b36-a59e-17ba370d29a1"
  env $extra timeout 1200 node "$t.js" > "out/$t.log" 2>&1
  code=$?
  echo "$t : exit $code · $(grep -v '^\s*$' "out/$t.log" | tail -1 | cut -c1-140)" | tee -a out/resume.log
done
echo FIN >> out/resume.log
