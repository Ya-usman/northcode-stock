// Dernière migration qui définit la règle (184, 214, 215…, trouvée toute seule) — les constantes de la règle SQL (role_can_view_feature) sont-elles
// EXACTEMENT celles de lib/permissions ? Échoue dès qu'une valeur par défaut, une fonction, READ_ONLY_ROLES, READ_ONLY_LOCKED
// ou GENERAL_EXEMPT change d'un côté
// sans l'autre (toute évolution = nouvelle migration). Test PUR, sans base.
// Usage : node tests/e2e/rls-feature-pure.mjs
import { readFileSync, readdirSync } from 'node:fs'
const P = await import(new URL('../../lib/permissions/index.ts', import.meta.url).href)
// Toujours la DERNIÈRE version de role_can_view_feature (plus de numéro écrit en dur à mettre à jour)
const DIR = new URL('../../supabase/migrations/', import.meta.url)
const file = readdirSync(DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()
  .filter(f => /FUNCTION public\.role_can_view_feature\(/.test(readFileSync(new URL(f, DIR), 'utf8'))).pop()
const sql = readFileSync(new URL(file, DIR), 'utf8')
console.log(`règle lue dans ${file}`)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const arr = name => {
  const m = sql.match(new RegExp(`${name} CONSTANT text\\[\\] := ARRAY\\[([^\\]]*)\\]`))
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : null
}
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())

const feats = [...P.LEVEL_FEATURES, ...P.SWITCH_FEATURES, ...P.WIDGET_FEATURES]
const known = arr('known')
ok(known && same(known, feats) && known.length === feats.length, `fonctions connues : ${known?.length} en SQL, ${feats.length} dans lib/permissions`)
ok(feats.every(f => P.DEFAULT_GENERAL[f] === true), 'onglet « Général » : toutes les fonctions à « oui » par défaut (hypothèse de la règle SQL)')
ok(same(arr('read_only_roles') || [], P.READ_ONLY_ROLES), `rôles en lecture seule identiques (${P.READ_ONLY_ROLES.join(', ')})`)
ok(same(arr('read_only_locked') || [], P.READ_ONLY_LOCKED), 'READ_ONLY_LOCKED identique')
ok(same(arr('general_exempt') || [], P.GENERAL_EXEMPT), 'GENERAL_EXEMPT identique')

const offM = sql.match(/off CONSTANT jsonb := '(\{[\s\S]*?\})';/)
const off = offM ? JSON.parse(offM[1]) : {}
ok(same(Object.keys(off), P.CONFIGURABLE_ROLES), `rôles configurables : ${Object.keys(off).join(', ')}`)
for (const r of P.CONFIGURABLE_ROLES) {
  const want = feats.filter(f => !P.DEFAULT_PERMISSIONS[r][f])
  ok(same(off[r] || [], want), `${r} : fonctions à « non » par défaut identiques (${want.length})`)
}
console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
