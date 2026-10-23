#!/bin/bash
# Tests à ÉCRITURE RÉELLE sur Boutique Alpha — à lancer seulement sur accord explicite.
# Chaque test active lui-même le mode écriture (lib/write-mode.js) : serveur local uniquement, cible vérifiée en base
# (Boutique Alpha), référence unique par exécution, nettoyage limité aux lignes de l'exécution, photo avant / après.
# Usage : bash tests/e2e/run-write.sh [test ...]   (journaux et bilans dans tests/e2e/out/write-resume.log)
cd "$(dirname "$0")"
export CAPTURE_BASE=http://localhost:3000
unset CAPTURE_PROD_READONLY
mkdir -p out
DEFAULT="stock-reserved product-detail inventory-v2 lot2-scope"
: > out/write-resume.log
node lib/vitrine-fixture.js >> out/write-resume.log 2>&1 || { echo "repères vitrine introuvables"; exit 1; }
for t in ${*:-$DEFAULT}; do
  timeout 1500 node "$t.js" > "out/$t.log" 2>&1
  code=$?
  { echo "== $t : exit $code · $(grep -v '^\s*$' "out/$t.log" | tail -1 | cut -c1-140)"
    sed -n '/^Mode écriture — bilan/,/traces restantes/p' "out/$t.log"; } | tee -a out/write-resume.log
done
echo FIN >> out/write-resume.log
