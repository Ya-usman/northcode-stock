// Contrôle EN LIGNE de pure lecture après push de 5356978 + ad48ed3 (lot 4 : Crédits + Historique des ventes).
// Compte vitrine Marché Soleil et son équipe ; lib/capture.js bloque TOUTE écriture (CAPTURE_PROD_READONLY=1).
// Rien n'est enregistré : les choix de boutique sont annulés, les fenêtres refermées sans valider.
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const SHOPS = [AKWA, BONA, BASTOS]
const OWNER = 'ghislainx123@gmail.com', FATOU = 'ghislainx123+fatou@gmail.com', MARIAM = 'ghislainx123+mariam@gmail.com'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

async function open(path, email = OWNER) {
  const s = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email })
  await s.page.addInitScript(() => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', 'all'); localStorage.setItem('active_shop_id', 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} })
  s.errors = []; s.requests = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('request', r => s.requests.push(r.url()))
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(8000)
  s.get = url => s.page.evaluate(async u => { const r = await fetch(u); let j = {}; try { j = await r.json() } catch {} return { status: r.status, json: j } }, url)
  return s
}

;(async () => {
  // Nouvelle version détectée par le refus fait au gestionnaire de stock (avant : 200)
  let live = false
  for (let i = 0; i < 40 && !live; i++) {
    const s = await open('offline', MARIAM)
    const r = await s.get(`/api/payments/debts?shop_ids=${BASTOS}`)
    live = r.status === 403
    console.log(new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }), 'Paris · nouvelle version :', live ? 'en ligne' : `pas encore (${r.status})`)
    if (live) {
      ok(true, 'gestionnaire de stock (Bastos) : dettes refusées (403) — droit « Crédits » exigé')
      ok((await s.get(`/api/sales/logs?shop_ids=${BASTOS}`)).status === 403, 'gestionnaire de stock : journal des ventes refusé (403)')
    }
    await s.browser.close()
    if (!live) await new Promise(r => setTimeout(r, 20000))
  }
  if (!live) { console.log('Nouvelle version non détectée'); process.exit(1) }

  console.log('\nCaissière d’Akwa')
  let s = await open('offline', FATOU)
  ok((await s.get(`/api/payments/audit?shop_ids=${AKWA}`)).status === 403, 'journal des crédits refusé (rôle hors direction)')
  const d = await s.get(`/api/payments/debts?shop_ids=${AKWA},${BASTOS}`)
  ok(d.status === 200 && (d.json.debtors || []).every(x => x.customer.shop_id === AKWA), `dettes Akwa + Bastos demandées : seulement Akwa (${(d.json.debtors || []).length})`)
  await s.browser.close()

  console.log('\nCrédits — propriétaire, « Toutes les boutiques »')
  s = await open('payments'); let page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  await page.getByTestId('opening-open').click()
  const n = await page.getByTestId('shop-picker').locator('[data-shop-option]').count().catch(() => 0)
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(600)
  ok(n === 3 && await page.getByTestId('opening-drawer').count() === 0, `reprise de dette → « Dans quelle boutique ? » (${n}), annulé sans rien ouvrir`)
  await page.getByRole('tab', { name: /^Journal/ }).click(); await page.waitForTimeout(3000)
  const audit = s.requests.find(u => u.includes('/api/payments/audit'))
  ok(!!audit && SHOPS.every(id => new URL(audit).searchParams.get('shop_ids')?.includes(id)), 'journal des crédits : les 3 boutiques')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\nHistorique des ventes — propriétaire, « Toutes les boutiques »')
  const { data: sales } = await db.from('sales').select('id, shop_id, sale_number').eq('shop_id', BASTOS).eq('sale_status', 'active').order('created_at', { ascending: false }).limit(1)
  s = await open('sales/history'); page = s.page
  ok(await page.getByTestId('shop-scope-badge').isVisible(), 'badge « Toutes les boutiques »')
  await page.locator('main button[role="combobox"]').first().click(); await page.getByRole('option', { name: /^Année$/ }).click(); await page.waitForTimeout(6000)
  const row = page.locator(`[data-sale-row="${sales[0].id}"]`)
  if (await row.count()) {
    await row.click(); await page.waitForTimeout(500)
    await page.getByRole('button', { name: /^Modifier$/ }).first().click(); await page.waitForTimeout(900)
    const before = s.requests.length
    await page.getByPlaceholder(/Rechercher un produit/).last().fill('a'); await page.waitForTimeout(2000)
    const req = s.requests.slice(before).find(u => u.includes('/rest/v1/products'))
    ok(!!req && req.includes(`shop_id=eq.${BASTOS}`), `modification de ${sales[0].sale_number} (Bastos) : produits de Bastos seulement — fenêtre refermée sans enregistrer`)
    await page.keyboard.press('Escape'); await page.waitForTimeout(500)
  } else ok(false, 'vente de Bastos introuvable dans la liste de l’année')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
