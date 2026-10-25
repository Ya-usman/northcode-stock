// Étape D — changement de permission « à chaud », écriture réelle autorisée (25 oct. 2026) sur Boutique Alpha :
// le propriétaire RETIRE « Voir les prix d'achat » au rôle Manager pendant que le manager est connecté, puis le RÉTABLIT.
// Mode écriture : serveur local, cible vérifiée en base, seule la route des réglages autorisée et pour Alpha.
// Réglages d'Alpha remis EXACTEMENT ; seules traces attendues : 2 entrées permissions.update au journal.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/d-hot-permission.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const { openPage } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const W = await enableWrite({ test: 'étape D — permission à chaud', routes: [/\/api\/team\/permissions$/] })
  const readRp = async () => (await W.db.from('shops').select('role_permissions').eq('id', ALPHA).single()).data.role_permissions
  const original = await readRp()
  const product = (await W.db.from('products').select('id').eq('shop_id', ALPHA).eq('is_active', true).limit(1).single()).data
  console.log(`Réglage manager.view_purchase_cost avant : ${JSON.stringify(original?.manager?.view_purchase_cost)} (absent = défaut OUI)`)

  const owner = await openPage({ width: 1280, height: 900, skipGoto: true, email: 'admin@northcode.ng', write: W })
  await owner.page.goto('http://localhost:3000/fr/offline', { waitUntil: 'domcontentloaded' })
  const manager = await openPage({ width: 1280, height: 900, skipGoto: true, email: 'cassierstock@gmail.com' })
  await manager.page.goto('http://localhost:3000/fr/offline', { waitUntil: 'domcontentloaded' })
  const call = (s, method, url, body) => s.page.evaluate(async ({ method, url, body }) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let t = ''; try { t = await r.text() } catch {} return { status: r.status, t } }, { method, url, body })
  const managerSees = async () => {
    const c = await call(manager, 'GET', `/api/costs?shop_ids=${ALPHA}`)
    const d = await call(manager, 'GET', `/api/stock/product-detail?shop_id=${ALPHA}&product_id=${product.id}`)
    return { costs: c.status, detailCost: /"buying_price"\s*:\s*-?\d/.test(d.t), detailStatus: d.status }
  }

  let m = await managerSees()
  ok(m.costs === 200 && m.detailCost, `manager connecté, AVANT : coûts servis (/api/costs ${m.costs}, fiche produit avec coût)`)

  const off = { ...original, manager: { ...(original?.manager || {}), view_purchase_cost: false } }
  let r = await call(owner, 'PATCH', '/api/team/permissions', { shop_id: ALPHA, role_permissions: off })
  ok(r.status === 200 && JSON.parse(r.t).changes === 1, `propriétaire RETIRE le coût au rôle Manager : ${r.status}, ${JSON.parse(r.t).changes} changement journalisé`)
  m = await managerSees()
  ok(m.costs === 403 && !m.detailCost && m.detailStatus === 200, `requête SUIVANTE du manager (sans reconnexion) : /api/costs ${m.costs}, fiche produit ${m.detailStatus} SANS coût`)

  r = await call(owner, 'PATCH', '/api/team/permissions', { shop_id: ALPHA, role_permissions: original })
  ok(r.status === 200 && JSON.parse(r.t).changes === 1, `propriétaire RÉTABLIT le réglage d'origine : ${r.status}, ${JSON.parse(r.t).changes} changement journalisé`)
  m = await managerSees()
  ok(m.costs === 200 && m.detailCost, `requête SUIVANTE du manager : coûts de nouveau servis (/api/costs ${m.costs})`)
  await wait(500)
  await owner.browser.close(); await manager.browser.close()

  const after = await readRp()
  ok(JSON.stringify(after) === JSON.stringify(original), 'réglages d’Alpha remis EXACTEMENT à l’identique')
  const v = await W.verify()
  const newRows = v.remaining.map(x => x.split(' ')[0])
  const logs = (await W.db.from('audit_logs').select('metadata, actor_email').eq('shop_id', ALPHA).eq('action', 'permissions.update').order('created_at', { ascending: false }).limit(2)).data || []
  ok(v.removed.length === 0 && v.modified.length === 0, `aucune ligne préexistante supprimée ni modifiée (${v.removed.length} / ${v.modified.length})`)
  ok(newRows.length === 2 && newRows.every(t => t === 'audit_logs'), `seules nouvelles lignes : ${newRows.length} entrée(s) de journal`)
  ok(logs.length === 2 && logs.every(l => l.metadata.role === 'manager' && l.metadata.permission === 'view_purchase_cost' && l.actor_email === 'admin@northcode.ng')
     && logs[1].metadata.from === true && logs[1].metadata.to === false && logs[0].metadata.from === false && logs[0].metadata.to === true,
     'journal : « manager · view_purchase_cost · oui → non » puis « non → oui », auteur = propriétaire')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
