// Prix d'achat : fuite du cache local des pages (lib/offline/page-cache.ts) corrigée ; l'ancienne route POST
// /api/stock/inventory-count (fuite de value_delta) est retirée depuis le 31 oct. 2026.
// Test PUR : faux localStorage, aucun réseau ni base.
// Usage : node tests/e2e/cost-leaks-pure.mjs   (Node ≥ 23 : lecture directe du TypeScript)

const ROOT = new URL('../../', import.meta.url)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }

// ── 1. Cache local des pages ────────────────────────────────────────────────
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null, get length() { return store.size },
}
const C = await import(new URL('lib/offline/page-cache.ts', ROOT).href)

const transfers = [{ id: 't1', reference: 'TR-1', stock_transfer_items: [{ product_name: 'Riz', quantity_sent: 3, buying_price: 12500, selling_price: 15000 }] }]
C.setPageCache('transfers_s1', transfers)
const raw = store.get('pc_transfers_s1')
ok(!raw.includes('buying_price') && raw.includes('"selling_price":15000') && raw.includes('"quantity_sent":3'), 'transferts : buying_price retiré du cache, le reste conservé')
ok(transfers[0].stock_transfer_items[0].buying_price === 12500, 'l’objet affiché à l’écran n’est pas modifié (coût toujours affichable depuis la réponse serveur)')
ok(C.getPageCache('transfers_s1')?.[0]?.stock_transfer_items?.[0]?.quantity_sent === 3, 'transferts : relecture du cache sans coût')

const supps = [{ supplier: 'Fourn', purchase_orders: [{ reference: 'BC-1', total_amount: 9000, purchase_order_items: [{ product_name: 'Riz', quantity_ordered: 2, unit_price: 4500 }] }] }]
C.setPageCache('supplier_payments_hist_s1', supps)
const raw2 = store.get('pc_supplier_payments_hist_s1')
ok(!/"unit_price"/.test(raw2) && raw2.includes('"quantity_ordered":2') && raw2.includes('"total_amount":9000'), 'paiements fournisseurs : prix des lignes de bons retiré, total du bon conservé')

const sales = [{ sale_number: 'V-1', sale_items: [{ product_name: 'Riz', quantity: 1, unit_price: 15000, buying_price: 12500 }] }]
C.setPageCache('sales_s1', sales)
const raw3 = store.get('pc_sales_s1')
ok(raw3.includes('"unit_price":15000') && !raw3.includes('buying_price'), 'ventes : prix de VENTE (unit_price) conservé, buying_price retiré')

const nested = { prods: [{ id: 'p', buying_price: 1, batches: [{ id: 'b', buying_price: 2 }] }] }
C.setPageCache('deep', nested)
ok(!store.get('pc_deep').includes('buying_price'), 'coût retiré à toute profondeur')

store.set('pc_old_transfers', JSON.stringify({ data: transfers, cached_at: Date.now() }))
ok(C.getPageCache('old_transfers') === null && !store.has('pc_old_transfers'), 'ancienne entrée avec buying_price : ignorée ET supprimée à la lecture')
store.set('pc_old_supp', JSON.stringify({ data: supps, cached_at: Date.now() }))
ok(C.getPageCache('old_supp') === null && !store.has('pc_old_supp'), 'ancienne entrée avec prix de ligne de bon : ignorée ET supprimée à la lecture')
store.set('pc_old_format', JSON.stringify(transfers))
ok(C.getPageCache('old_format') === null && !store.has('pc_old_format'), 'ancien format (sans cached_at) avec coût : ignoré ET supprimé')
store.set('pc_clean', JSON.stringify({ data: sales.map(s => ({ ...s, sale_items: [{ product_name: 'Riz', unit_price: 15000 }] })), cached_at: Date.now() }))
ok(C.getPageCache('clean')?.[0]?.sale_items?.[0]?.unit_price === 15000, 'entrée sans coût : servie normalement')

store.clear()
store.set('pc_a', JSON.stringify({ data: transfers, cached_at: 1 })); store.set('pc_b', JSON.stringify({ data: supps, cached_at: 1 }))
store.set('pc_c', JSON.stringify({ data: [{ unit_price: 3 }], cached_at: 1 })); store.set('rq_cache_v1', '{}'); store.set('autre', '{"buying_price":1}')
const removed = C.purgeCostCaches()
ok(removed === 3 && !store.has('pc_a') && !store.has('pc_b') && store.has('pc_c') && !store.has('rq_cache_v1') && store.has('autre'),
   `purge au démarrage : transferts + bons + ancien cache Rapports supprimés, ventes conservées, hors cache non touché (${removed})`)

// ── 2. Ancienne route POST /api/stock/inventory-count : RETIRÉE le 31 oct. 2026 ──
// Plus aucun écran ne l'appelait (les inventaires passent par /api/stock/inventory-sessions) ; elle modifiait le stock
// directement. La fuite de value_delta qu'elle avait ne peut donc plus se produire : on vérifie qu'elle n'existe plus.
const { existsSync } = await import('node:fs')
ok(!existsSync(new URL('app/api/stock/inventory-count/route.ts', ROOT)), 'ancienne route d’inventaire direct retirée (plus de porte d’écriture hors inventaires par sessions)')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
