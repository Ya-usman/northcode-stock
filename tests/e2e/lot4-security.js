// Lot 4 — contrôles serveur (Crédits + Historique des ventes).
// Partie A : LECTURE SEULE sur le compte vitrine Marché Soleil (requêtes GET uniquement ; écritures bloquées par capture.js),
//   avec les comptes de l'équipe vitrine : propriétaire, gérant d'Akwa, caissière d'Akwa, gestionnaire de stock de Bastos.
// Partie B : Boutique Alpha, MODE ÉCRITURE explicite (lib/write-mode.js) — requêtes conçues pour être REFUSÉES avant
//   toute écriture ; la photo avant / après prouve qu'aucune ligne n'est créée ni modifiée.
// Usage : CAPTURE_BASE=http://localhost:3000 node lot4-security.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const { enableWrite } = require('./lib/write-mode.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b'
const OWNER = 'ghislainx123@gmail.com', JEANPAUL = 'ghislainx123+jeanpaul@gmail.com', FATOU = 'ghislainx123+fatou@gmail.com', MARIAM = 'ghislainx123+mariam@gmail.com'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function as(email, write = null) {
  const s = await session({ width: 1280, height: 900, email, write })
  await s.page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  s.call = (method, url, body) => s.page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    let j = {}; try { j = await r.json() } catch {}
    return { status: r.status, json: j }
  }, { method, url, body })
  return s
}
const shopsOf = rows => [...new Set((rows || []).map(x => x.shop_id ?? x.customer?.shop_id))].sort()

;(async () => {
  console.log('Base :', BASE)
  // ══ A. Lecture seule — vitrine ═════════════════════════════════════════════
  console.log('\nA1. Dettes clients (/api/payments/debts)')
  let s = await as(OWNER)
  let r = await s.call('GET', `/api/payments/debts?shop_ids=${AKWA},${BASTOS},${BONA}`)
  ok(r.status === 200, `propriétaire, 3 boutiques : 200 (${(r.json.debtors || []).length} débiteurs)`)
  const anyDebtor = (r.json.debtors || [])[0]
  r = await s.call('GET', `/api/payments/history-all?shop_ids=${AKWA},${BASTOS},${BONA}`)
  ok(r.status === 200, `propriétaire : historique de tous les clients 200 (${(r.json.customers || []).length})`)
  if (anyDebtor) {
    r = await s.call('GET', `/api/payments/history?shop_id=${anyDebtor.customer.shop_id}&customer_id=${anyDebtor.customer.id}`)
    ok(r.status === 200 && Array.isArray(r.json.sales), `propriétaire : historique d’un client 200 (${r.json.sales?.length} ventes)`)
  }
  r = await s.call('GET', `/api/payments/audit?shop_ids=${AKWA},${BASTOS}`)
  ok(r.status === 200, 'propriétaire : journal des crédits sur 2 boutiques (shop_ids) 200')
  r = await s.call('GET', `/api/sales/logs?shop_ids=${AKWA},${BASTOS},${BONA}`)
  ok(r.status === 200, 'propriétaire : journal des ventes 200')
  await s.browser.close()

  console.log('\nA2. Gestionnaire de stock (Bastos) : aucun droit « Crédits » ni « Historique »')
  s = await as(MARIAM)
  r = await s.call('GET', `/api/payments/debts?shop_ids=${BASTOS}`)
  ok(r.status === 403, `dettes de Bastos : refusé (${r.status}) — avant : l’appartenance suffisait`)
  r = await s.call('GET', `/api/payments/history-all?shop_ids=${BASTOS}`)
  ok(r.status === 403, `historique de tous les clients : refusé (${r.status})`)
  if (anyDebtor) {
    r = await s.call('GET', `/api/payments/history?shop_id=${BASTOS}&customer_id=${anyDebtor.customer.id}`)
    ok(r.status === 403, `historique d’un client : refusé (${r.status})`)
  }
  r = await s.call('GET', `/api/payments/debts?shop_ids=${BASTOS}&customer_id=${anyDebtor?.customer.id || '00000000-0000-0000-0000-000000000000'}`)
  ok(r.status === 403, `exception de la caisse : sans le droit de vendre, refusé aussi (${r.status})`)
  r = await s.call('GET', `/api/sales/logs?shop_ids=${BASTOS}`)
  ok(r.status === 403, `journal des ventes : refusé (${r.status})`)
  await s.browser.close()

  console.log('\nA3. Caissière (Akwa) : « Crédits » en consultation, pas de journal')
  s = await as(FATOU)
  r = await s.call('GET', `/api/payments/debts?shop_ids=${AKWA},${BASTOS}`)
  ok(r.status === 200 && shopsOf(r.json.debtors).every(id => id === AKWA), `dettes Akwa + Bastos demandées : seulement Akwa (${shopsOf(r.json.debtors).length} boutique)`)
  const akwaDebtor = (r.json.debtors || [])[0]
  if (akwaDebtor) {
    r = await s.call('GET', `/api/payments/debts?shop_id=${AKWA}&customer_id=${akwaDebtor.customer.id}`)
    ok(r.status === 200 && r.json.debtors.length === 1 && r.json.debtors[0].customer.id === akwaDebtor.customer.id, 'caisse (customer_id) : la dette de CE client seulement')
  }
  r = await s.call('GET', `/api/payments/audit?shop_ids=${AKWA}`)
  ok(r.status === 403, `journal des crédits : refusé (rôle hors direction) (${r.status})`)
  r = await s.call('GET', `/api/sales/logs?shop_ids=${AKWA}`)
  ok(r.status === 403, `journal des ventes : refusé (${r.status})`)
  await s.browser.close()

  console.log('\nA4. Gérant (Akwa seulement)')
  s = await as(JEANPAUL)
  r = await s.call('GET', `/api/payments/audit?shop_ids=${AKWA},${BASTOS}`)
  ok(r.status === 200 && (r.json.logs || []).every(l => l.shop_id === AKWA), `journal des crédits Akwa + Bastos demandés : seulement Akwa (${(r.json.logs || []).length} entrées)`)
  r = await s.call('GET', `/api/payments/audit?shop_ids=${BASTOS}`)
  ok(r.status === 403, `journal des crédits de Bastos seule : refusé (${r.status})`)
  r = await s.call('GET', `/api/sales/logs?shop_ids=${AKWA},${BASTOS}`)
  ok(r.status === 200 && (r.json.logs || []).every(l => !l.shop_id || l.shop_id === AKWA), 'journal des ventes : Akwa seulement')
  await s.browser.close()

  // ══ B. Mode écriture — Alpha, requêtes refusées avant écriture ════════════
  console.log('\nB. Serveur — requêtes refusées (Boutique Alpha, mode écriture)')
  const W = await enableWrite({ test: 'lot4-security (partie B)', routes: [/\/api\/payments(\?|$)/, /\/api\/sales\/edit(\?|$)/] })
  const sale = (await db.from('sales').select('id, sale_number, customer_id, total').eq('shop_id', ALPHA).eq('sale_status', 'active').order('created_at', { ascending: false }).limit(1).single()).data
  const foreignProd = (await db.from('products').select('id, name').eq('shop_id', AKWA).limit(1).single()).data
  const alphaProd = (await db.from('products').select('id, name, selling_price').eq('shop_id', ALPHA).eq('is_active', true).gt('selling_price', 0).limit(1).single()).data
  const foreignCustomer = (await db.from('customers').select('id').eq('shop_id', AKWA).limit(1).single()).data
  let clean = false
  try {
    s = await as('admin@northcode.ng', W)
    r = await s.call('POST', '/api/payments', { shop_id: ALPHA, unpaid_sale_ids: [crypto.randomUUID()], amount: 1, method: 'cash', client_request_id: '%' })
    ok(r.status === 400, `paiement avec identifiant « % » : refusé (${r.status}) — avant : recherche dans toutes les boutiques`)
    r = await s.call('POST', '/api/payments', { shop_id: ALPHA, unpaid_sale_ids: [crypto.randomUUID()], amount: 1, method: 'cash', client_request_id: 'a_b' })
    ok(r.status === 400, `identifiant avec « _ » (joker) : refusé (${r.status})`)
    const line = p => ({ product_id: p.id, product_name: 'TEST lot 4', quantity: 1, unit_price: Number(p.selling_price || 1) })
    r = await s.call('POST', '/api/sales/edit', { shop_id: ALPHA, sale_id: sale.id, payment_method: 'cash', items: [line(foreignProd)] })
    ok(r.status === 400 && r.json.code === 'sale_product_wrong_shop', `modification de la vente ${sale.sale_number} avec un produit d’une autre entreprise : refusée (${r.status} ${r.json.code})`)
    r = await s.call('POST', '/api/sales/edit', { shop_id: ALPHA, sale_id: sale.id, payment_method: 'cash', customer_id: foreignCustomer.id, items: [line(alphaProd)] })
    ok(r.status === 400 && r.json.code === 'sale_customer_wrong_shop', `… avec un client d’une autre entreprise : refusée (${r.status} ${r.json.code})`)
    await s.browser.close()
  } finally {
    clean = await W.finish({})
  }
  ok(clean, 'mode écriture : aucune ligne créée ni modifiée (vente intacte), aucune trace')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
