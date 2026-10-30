// Captures d'écran EN LIGNE (lecture seule) après C2 / C3 — compte vitrine Marché Soleil ; lib/capture.js bloque toute
// écriture ; on ouvre, on photographie, on ferme sans valider. Usage : OUT_DIR=<dossier> node tests/e2e/prod-shots-c2c3.js
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const path = require('path')
const fs = require('fs')
const { session, BASE } = require('./lib/capture.js')
const fr = require('../../messages/fr.json')
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out', 'shots-c2c3')
fs.mkdirSync(OUT, { recursive: true })
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const wait = ms => new Promise(r => setTimeout(r, ms))

async function open(email, shop, p) {
  process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  await s.page.goto(`${BASE}/fr/${p}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await wait(7000)
  return s
}
const shot = async (s, name, opts = {}) => { const f = path.join(OUT, name); await s.page.screenshot({ path: f, ...opts }); console.log('capture :', f) }

;(async () => {
  // 1. Réglages du propriétaire : « Finances & coûts »
  let s = await open('ghislainx123@gmail.com', AKWA, 'settings')
  await s.page.getByRole('button', { name: fr.roles.manager, exact: true }).first().click(); await wait(800)
  await s.page.getByTestId('perm-section-finance').scrollIntoViewIfNeeded(); await wait(500)
  await shot(s, '1-proprietaire-reglages-finances-couts.png')
  await s.browser.close()

  // 2. Crédits « Je dois » (propriétaire)
  s = await open('ghislainx123@gmail.com', AKWA, 'payments')
  await s.page.getByRole('tab', { name: fr.payments.side_payable, exact: true }).first().click().catch(() => {}); await wait(4000)
  await shot(s, '2-proprietaire-credits-je-dois.png')
  await s.browser.close()

  // 3. Bons de commande + réception (propriétaire : droit de payer)
  s = await open('ghislainx123@gmail.com', AKWA, 'suppliers?view=purchase_orders')
  await shot(s, '3a-proprietaire-bons-de-commande.png')
  await s.page.locator('[data-po-card="BC-2026-0005"] button:visible', { hasText: fr.suppliers.po_mark_received }).first().click().catch(() => {}); await wait(1800)
  await shot(s, '3b-proprietaire-reception-avec-paiement.png')
  await s.page.keyboard.press('Escape')
  await s.browser.close()

  // 4. Magasinière de Bastos : produits (coût conservé par la 181) et Fournisseurs (sans dette)
  s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'stock/products')
  await shot(s, '4a-magasiniere-produits.png')
  await s.browser.close()
  s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'suppliers')
  await shot(s, '4b-magasiniere-fournisseurs-sans-dette.png')
  await s.browser.close()

  // 5. Caissière d'Akwa : caisse (aucun coût)
  s = await open('ghislainx123+fatou@gmail.com', AKWA, 'sales/new')
  await shot(s, '5-caissiere-caisse.png')
  await s.browser.close()
  console.log('FIN')
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
