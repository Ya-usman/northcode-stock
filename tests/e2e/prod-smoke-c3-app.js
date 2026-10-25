// Contrôle EN LIGNE de pure lecture après le déploiement des corrections C3 (4035dc5). Compte vitrine Marché Soleil ;
// lib/capture.js bloque toute écriture ; on ouvre, on lit, on ferme sans valider.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const { session, BASE } = require('./lib/capture.js')
const fr = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'

async function open(email, shop, path) {
  process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.bodies = []; s.denied = []
  s.page.on('response', async r => {
    const u = r.url(); if (!/\/api\/|\/rest\/v1\//.test(u)) return
    if (/\/rest\/v1\//.test(u) && (r.status() === 401 || r.status() === 403)) s.denied.push(`${r.status()} ${u.replace(/\?.*/, '')}`)
    try { s.bodies.push({ u, status: r.status(), t: await r.text() }) } catch {}
  })
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(7000)
  return s
}
const poList = s => { const b = s.bodies.find(x => /\/api\/purchase-orders\?/.test(x.u) && x.status === 200); try { return JSON.parse(b.t).data || [] } catch { return null } }

;(async () => {
  for (const [label, email] of [['Propriétaire', 'ghislainx123@gmail.com'], ['Responsable', 'ghislainx123+jeanpaul@gmail.com']]) {
    console.log(`\n${label} d'Akwa — bons de commande`)
    const s = await open(email, AKWA, 'suppliers?view=purchase_orders')
    const list = poList(s)
    const received = (list || []).find(p => p.status === 'received' || p.status === 'partial')
    ok(Array.isArray(list) && list.length > 0, `liste des bons reçue (${list?.length ?? 0})`)
    ok(!!received && 'total_amount' in received && 'amount_paid' in received && 'balance' in received && 'payment_status' in received, 'droits coût + dette : total, payé, solde et statut présents')
    const sent = (list || []).find(p => p.status === 'sent')
    if (sent) {
      await s.page.locator(`[data-po-card="${sent.reference}"] button:visible`, { hasText: fr.suppliers.po_mark_received }).first().click()
      await s.page.waitForTimeout(1500)
      const dt = await s.page.getByTestId('po-receive-drawer').innerText().catch(() => '')
      ok(dt.includes(fr.suppliers.section_payment), `réception de ${sent.reference} : partie « ${fr.suppliers.section_payment} » proposée (droit de payer) — fermée sans valider`)
      await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(400)
    }
    ok(s.errors.length === 0 && s.denied.length === 0, `aucune erreur JavaScript ni refus de lecture${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
    await s.browser.close()
  }

  console.log("\nPropriétaire — Crédits « Je dois »")
  let s = await open('ghislainx123@gmail.com', AKWA, 'payments')
  // L'écran s'ouvre sur « On me doit » : les dettes fournisseurs ne sont demandées qu'en basculant sur « Je dois »
  await s.page.getByRole('button', { name: fr.payments?.side_payable || 'Je dois', exact: true }).first().click().catch(() => {})
  await s.page.waitForTimeout(4000)
  ok(s.bodies.some(b => /\/api\/supplier-payments\/debts/.test(b.u) && b.status === 200) || s.bodies.some(b => /\/api\/supplier-payments/.test(b.u) && b.status === 200), 'dettes fournisseurs servies par la route serveur')
  ok(s.errors.length === 0 && s.denied.length === 0, `aucune erreur JavaScript ni refus de lecture${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
  await s.browser.close()

  console.log('\nMagasinière de Bastos — Fournisseurs, sans droit dette')
  s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'suppliers')
  const owed = s.bodies.filter(b => /"total_owed"\s*:\s*[1-9]/.test(b.t)).map(b => b.u.replace(/\?.*/, ''))
  ok(owed.length === 0, `aucune réponse avec un solde dû${owed.length ? ' — ' + [...new Set(owed)].join(', ') : ''}`)
  ok(s.bodies.filter(b => /\/api\/purchase-orders\?/.test(b.u)).every(b => !/"(amount_paid|balance|payment_status)"/.test(b.t)), 'bons : ni payé, ni solde, ni statut de paiement')
  ok(s.errors.length === 0 && s.denied.length === 0, `aucune erreur JavaScript ni refus de lecture${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
