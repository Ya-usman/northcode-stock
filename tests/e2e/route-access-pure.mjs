// Garde d'entrée des écrans — correspondance adresse → fonction (lib/navigation/route-access.ts). Test PUR.
// Usage : node tests/e2e/route-access-pure.mjs
const R = await import(new URL('../../lib/navigation/route-access.ts', import.meta.url).href)
const P = await import(new URL('../../lib/permissions/index.ts', import.meta.url).href)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const CASES = [
  ['/fr/sales/new', null], ['/en/sales/history', 'sales_history'], ['/fr/payments', 'payments'], ['/fr/payments?pay_supplier=x', 'payments'],
  ['/fr/customers', 'customers'], ['/fr/customers/123', 'customers'], ['/fr/stock', 'stock'], ['/fr/stock/products', 'stock'],
  ['/fr/stock/movements', 'movements'], ['/fr/stock/expiry', 'expiry_list'], ['/fr/stock/transfers', 'transfers'],
  ['/fr/stock/inventory-count', 'inventory_count'], ['/fr/categories', 'categories'], ['/fr/suppliers?view=purchase_orders', 'suppliers'],
  ['/fr/caisse', 'caisse'], ['/ha/reports', 'reports'], ['/fr/notes', 'notes'], ['/fr/expenses', 'expenses'],
  ['/fr/dashboard', null], ['/fr/help', null], ['/fr/settings', null], ['/fr/team', null], ['/fr/shops/abc', null], ['/fr/billing', null], ['/fr', null],
  ['/fr/stockage', null], ['/fr/notesx', null],
]
for (const [path, want] of CASES) ok((R.ruleForPath(path)?.feature ?? null) === want, `${path} → ${want ?? 'aucune garde'}`)
const known = new Set([...P.LEVEL_FEATURES, ...P.SWITCH_FEATURES])
ok(R.ROUTE_RULES.every(r => known.has(r.feature)), 'toutes les fonctions de la table existent dans lib/permissions')
console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
