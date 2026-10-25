// Contrôle EN LIGNE de pure lecture après 181 + 182 et le déploiement de view_purchase_cost (420b43e / fab4291).
// Compte vitrine Marché Soleil ; lib/capture.js bloque toute écriture ; on ouvre, on lit, on ferme sans enregistrer.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const { session, BASE } = require('./lib/capture.js')
const fr = require('../../messages/fr.json')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'

async function open(email, shop, path, wait = 7000) {
  process.env.CAPTURE_EMAIL = email; process.env.PIN_SHOP = shop
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.bodies = []; s.costCalls = 0; s.denied = []
  s.page.on('response', async r => {
    const u = r.url(); if (!/\/api\/|\/rest\/v1\//.test(u)) return
    if (/\/api\/costs/.test(u)) s.costCalls++
    if (/\/rest\/v1\//.test(u) && (r.status() === 401 || r.status() === 403)) s.denied.push(`${r.status()} ${u.replace(/\?.*/, '')}`)
    try { s.bodies.push({ u, t: await r.text() }) } catch {}
  })
  s.frames = []
  s.page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') s.frames.push(f.payload) }))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(wait)
  return s
}
const leaks = s => [...new Set(s.bodies.filter(b => /"buying_price"\s*:\s*-?\d/.test(b.t)).map(b => b.u.replace(/\?.*/, '')))]

;(async () => {
  // 1. Attente de la nouvelle version : section « Finances & coûts » dans les réglages du propriétaire
  let live = false
  for (let i = 0; i < 30 && !live; i++) {
    const s = await open('ghislainx123@gmail.com', AKWA, 'settings', 6000)
    live = await s.page.getByTestId('perm-section-finance').count() > 0
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvelle version :', live ? 'oui' : 'pas encore')
    if (live) {
      console.log('\n1. Propriétaire — réglages')
      const tab = name => s.page.getByRole('button', { name, exact: true }).first()
      ok((await s.page.getByTestId('perm-section-finance').innerText()).includes(fr.settings.perm_view_purchase_cost), `section « ${fr.settings.perm_section_finance} »`)
      await tab(fr.roles.manager).click(); await s.page.waitForTimeout(600)
      ok(await s.page.getByTestId('perm-view-purchase-cost').getAttribute('data-state') === 'checked', `« ${fr.roles.manager} » : coût activé par défaut`)
      await tab(fr.settings.role_cashier).click(); await s.page.waitForTimeout(600)
      ok(await s.page.getByTestId('perm-view-purchase-cost').getAttribute('data-state') === 'unchecked', `« ${fr.settings.role_cashier} » : coût désactivé par défaut`)
      ok(await s.page.getByTestId('perm-owner-cost').getByRole('switch').isDisabled(), 'propriétaire : verrouillé, toujours actif')
      ok(s.errors.length === 0 && s.denied.length === 0, `aucune erreur JavaScript ni refus de lecture${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }

  console.log('\n2. Magasinière de Bastos — accès conservé par la 181 (coût par le serveur)')
  let s = await open('ghislainx123+mariam@gmail.com', BASTOS, 'stock/products')
  ok(s.costCalls > 0, 'coûts demandés à /api/costs (droit conservé)')
  ok(s.bodies.filter(b => /\/rest\/v1\//.test(b.u)).every(b => !/"buying_price"\s*:/.test(b.t)), 'lectures directes de la base : jamais de buying_price')
  ok(s.denied.length === 0 && s.errors.length === 0, `aucun refus de lecture ni erreur JavaScript${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
  await s.browser.close()

  console.log('\n3. Caissière d\'Akwa — aucun coût nulle part')
  for (const path of ['sales/new', 'dashboard']) {
    s = await open('ghislainx123+fatou@gmail.com', AKWA, path)
    ok(leaks(s).length === 0 && s.costCalls === 0, `${path} : aucune réponse avec un prix d'achat, aucun appel à /api/costs${leaks(s).length ? ' — ' + leaks(s).join(', ') : ''}`)
    ok(s.frames.every(f => !f.includes('buying_price')), `${path} : aucune trame temps réel avec buying_price (${s.frames.length} trame(s))`)
    ok(s.denied.length === 0 && s.errors.length === 0, `${path} : aucun refus de lecture ni erreur JavaScript${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
    await s.browser.close()
  }

  console.log('\n4. Responsable d\'Akwa — coût par défaut, par le serveur')
  s = await open('ghislainx123+jeanpaul@gmail.com', AKWA, 'stock/products')
  ok(s.costCalls > 0 && s.bodies.filter(b => /\/rest\/v1\//.test(b.u)).every(b => !/"buying_price"\s*:/.test(b.t)), 'coûts par /api/costs, jamais par la base')
  ok(s.denied.length === 0 && s.errors.length === 0, `aucun refus de lecture ni erreur JavaScript${s.denied.length ? ' — ' + s.denied.join(', ') : ''}`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
