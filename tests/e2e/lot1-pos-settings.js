// Lot 1 — Caisse et Paramètres en contexte boutique. LECTURE SEULE (compte vitrine Marché Soleil) : toute écriture
// vers /api est interceptée ; l'encaissement reçoit un REFUS simulé (400 → jamais mis en file hors connexion) après
// lecture de son contenu. Droits par boutique (D2) : réglage « vente » désactivé pour Bastos DANS CE NAVIGATEUR seulement.
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (!/localhost/.test(process.env.CAPTURE_BASE)) { console.error('Ce test vise le serveur local uniquement'); process.exit(1) }
const capture = require('./lib/capture.js')
const { BASE } = capture
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const FULL = { [AKWA]: 'Marché Soleil Akwa', [BONA]: 'Marché Soleil Bonapriso', [BASTOS]: 'Marché Soleil Bastos' }
let pass = 0, fail = 0
const CASH_EXACT = 'Montant exact'
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

// shop : null = « Toutes » ; noSaleIn : boutique où le réglage « vente » est coupé (navigateur seulement)
async function open(path, { shop = null, width = 1366, height = 900, noSaleIn = null } = {}) {
  const s = await capture.session({ width, height, scale: 1, locale: 'fr' })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', id || 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.writes = []; s.errors = []; s.dialogs = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.page.on('dialog', d => { s.dialogs.push(d.message()); d.dismiss().catch(() => {}) })
  if (noSaleIn) {
    await s.page.route(/\/rest\/v1\/(shops|shop_members)\?/, async route => {
      if (route.request().method() !== 'GET') return route.fallback()
      const res = await route.fetch()
      let body = await res.text()
      try {
        const patch = x => {
          if (Array.isArray(x)) return x.map(patch)
          if (x && typeof x === 'object') {
            const o = {}; for (const [k, v] of Object.entries(x)) o[k] = patch(v)
            if (o.id === noSaleIn && 'role_permissions' in o) o.role_permissions = { ...(o.role_permissions || {}), general: { ...((o.role_permissions || {}).general || {}), new_sale: false } }
            return o
          }
          return x
        }
        body = JSON.stringify(patch(JSON.parse(body)).valueOf()).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false')
      } catch {}
      return route.fulfill({ response: res, body })
    })
  }
  await s.page.route(/\/api\//, route => {
    const r = route.request(), url = new URL(r.url())
    if (r.method() === 'GET') return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, body })
    if (url.pathname === '/api/sales/checkout') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'TEST — vente interceptée' }) })
    if (url.pathname === '/api/auth/set-role') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.waitForTimeout(6000)
  return s
}
const pickShop = async (page, id) => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); await p.locator(`[data-shop-option="${id}"]`).click(); await page.waitForTimeout(2500) }
const pickerOptions = async page => { const p = page.getByTestId('shop-picker'); await p.waitFor({ timeout: 10000 }); return p.locator('[data-shop-option]').evaluateAll(els => els.map(e => e.getAttribute('data-shop-option'))) }
const switchTo = async (page, label) => {
  await page.getByTestId('header-shop-context').click(); await page.waitForTimeout(300)
  await page.locator('header button', { hasText: label }).last().click(); await page.waitForTimeout(3500)
}
const headerTxt = async page => (await page.getByTestId('header-shop-context').innerText()).trim()
const gridText = async page => (await page.locator('[data-tour="pos-grid"]').innerText().catch(() => ''))

;(async () => {
  const prods = (await db.from('products').select('name, shop_id').in('shop_id', [AKWA, BONA, BASTOS]).eq('is_active', true).gt('quantity', 0)).data
  // Repères : un produit d'Akwa absent de Bastos, et un produit de Bastos absent d'Akwa
  const names = shop => new Set(prods.filter(p => p.shop_id === shop).map(p => p.name))
  const A = names(AKWA), B = names(BASTOS)
  // Bastos n'a aucune référence propre (toutes existent aussi à Akwa) : boutique identifiée par « Vendre dans »,
  // par l'absence d'un produit propre à Akwa, et par la boutique réellement envoyée à l'encaissement
  const akwaOnly = [...A].find(n => !B.has(n)), bastosOnly = [...B].sort()[0]
  console.log(`Repères : « ${akwaOnly} » (Akwa, pas Bastos), « ${bastosOnly} » (produit de Bastos)`)
  if (!akwaOnly || !bastosOnly) throw new Error('repères introuvables')

  console.log('\n1. Caisse en « Toutes les boutiques »')
  let s = await open('sales/new'); let page = s.page
  ok(await page.getByTestId('pos-pick-shop').isVisible() && await page.locator('[data-tour="pos-grid"]').count() === 0, '« Dans quelle boutique vendez-vous ? », aucun produit ni panier avant le choix')
  await page.getByTestId('pos-pick-shop').getByRole('button').click()
  const opts = await pickerOptions(page)
  ok(opts.length === 3, `choix : les 3 boutiques où la personne peut vendre (${opts.map(o => FULL[o]).join(', ')})`)
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click(); await page.waitForTimeout(600)
  ok(await page.getByTestId('pos-pick-shop').isVisible() && await page.locator('[data-tour="pos-grid"]').count() === 0, 'annuler : toujours aucune caisse ouverte (aucune boutique prise à la place)')
  await page.getByTestId('pos-pick-shop').getByRole('button').click(); await pickShop(page, BASTOS)
  await page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1500)
  const g = await gridText(page)
  const sidebar = await page.locator('aside').first().innerText().catch(() => '')
  ok(g.includes(bastosOnly) && !g.includes(akwaOnly) && /Vendre dans:?\s*Marché Soleil Bastos/.test(await page.locator('main').innerText()), `caisse ouverte sur Bastos : « Vendre dans : Marché Soleil Bastos », « ${akwaOnly} » (Akwa) absent`)
  ok(sidebar.includes('Marché Soleil Bastos') && !/Toutes les boutiques/.test(sidebar.split('\n').slice(0, 6).join(' ')), 'l’en-tête (barre latérale) est passé sur « Marché Soleil Bastos »')
  const sel = await page.locator('main').getByText('Vendre dans').first().isVisible().catch(() => false)
  ok(sel, 'boutique de vente affichée dans la caisse (« Vendre dans … »)')
  // Vente : le panier part vers Bastos (refus simulé, rien enregistré)
  await page.locator('[data-tour="pos-grid"]').getByText(bastosOnly, { exact: false }).first().click(); await page.waitForTimeout(800)
  await page.getByRole('button', { name: CASH_EXACT }).first().click().catch(() => {}); await page.waitForTimeout(400)
  await page.locator('[data-tour="pos-checkout"]:visible').first().click().catch(() => {})
  await page.waitForTimeout(2500)
  const sale = s.writes.find(w => w.path === '/api/sales/checkout')
  ok(sale && sale.body.shop_id === BASTOS, `encaissement envoyé vers ${sale ? FULL[sale.body.shop_id] || sale.body.shop_id : '(aucun envoi)'} (intercepté, refus simulé)`)
  const pending = await page.evaluate(() => new Promise(res => { const r = indexedDB.open('stockshop-offline'); r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('pending_sales')) return res(0); const q = d.transaction('pending_sales').objectStore('pending_sales').count(); q.onsuccess = () => res(q.result); q.onerror = () => res(-1) }; r.onerror = () => res(-1) }))
  ok(pending === 0, `aucune vente mise en file hors connexion (${pending})`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n2. Passage Akwa → Toutes → Bastos (téléphone)')
  s = await open('sales/new', { shop: AKWA, width: 390, height: 844 }); page = s.page
  await page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1000)
  ok(await headerTxt(page) === 'Akwa' && (await gridText(page)).includes(akwaOnly), 'Akwa : caisse d’Akwa directement, sans question')
  await page.locator('[data-tour="pos-grid"]').getByText(akwaOnly, { exact: false }).first().click(); await page.waitForTimeout(800)
  const cartBefore = await page.locator('[data-tour="pos-open-cart"]:visible').count()
  await switchTo(page, 'Toutes les boutiques')
  ok(await headerTxt(page) === 'Toutes' && await page.getByTestId('pos-pick-shop').isVisible() && await page.locator('[data-tour="pos-grid"]').count() === 0,
    `→ Toutes : caisse fermée, choix demandé (panier d’Akwa ${cartBefore ? 'présent avant' : '?'} — non repris)`)
  await switchTo(page, 'Marché Soleil Bastos')
  await page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 20000 }); await page.waitForTimeout(1200)
  ok(await headerTxt(page) === 'Bastos' && (await gridText(page)).includes(bastosOnly) && !(await gridText(page)).includes(akwaOnly) && await page.locator('[data-tour="pos-open-cart"]:visible').count() === 0,
    '→ Bastos : produits de Bastos, panier vide (rien d’Akwa)')
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n3. Droits par boutique (vente coupée à Bastos, dans ce navigateur)')
  s = await open('sales/new', { noSaleIn: BASTOS }); page = s.page
  await page.getByTestId('pos-pick-shop').getByRole('button').click()
  const opts2 = await pickerOptions(page)
  ok(opts2.length === 2 && !opts2.includes(BASTOS), `choix limité aux boutiques où la vente est permise (${opts2.map(o => FULL[o]).join(', ')})`)
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click()
  await s.browser.close()
  s = await open('sales/new', { shop: BASTOS, noSaleIn: BASTOS }); page = s.page
  ok(await page.getByTestId('pos-no-right').isVisible() && /vendre dans Marché Soleil Bastos/.test(await page.getByTestId('pos-no-right').innerText()) && await page.locator('[data-tour="pos-grid"]').count() === 0,
    'en-tête sur Bastos : « Vous n’avez pas le droit de vendre dans Marché Soleil Bastos », aucune caisse')
  await s.browser.close()

  console.log('\n4. Paramètres')
  s = await open('settings'); page = s.page
  const body0 = await page.locator('main').innerText()
  ok(await page.getByTestId('settings-pick-shop').isVisible() && !/Informations de la boutique/i.test(body0) && /Apparence/i.test(body0) && /Langue/i.test(body0),
    '« Toutes » : choix de la boutique demandé ; aucune section de boutique ; apparence et langue affichées')
  await page.getByTestId('settings-pick-shop').getByRole('button').click(); await pickShop(page, AKWA)
  ok((await page.getByTestId('settings-shop').innerText()).includes('Réglages de : Marché Soleil Akwa'), 'Akwa choisie : « Réglages de : Marché Soleil Akwa »')
  const nameInput = page.locator('main input[placeholder="Boutique Alpha"]')
  ok(await nameInput.inputValue() === FULL[AKWA], `formulaire d’Akwa (nom « ${await nameInput.inputValue()} »)`)
  const saveBtn = page.locator('[data-tour="settings-save"]')
  ok((await saveBtn.innerText()).includes('Enregistrer les réglages de Marché Soleil Akwa'), 'bouton : « Enregistrer les réglages de Marché Soleil Akwa »')
  ok((await page.getByTestId('settings-permissions-shop').innerText().catch(() => '')).includes('Marché Soleil Akwa'), 'accès par rôle : boutique rappelée')
  await nameInput.fill('TEST nom modifié non enregistré'); await page.waitForTimeout(300)
  await page.locator('aside').getByText('Marché Soleil Akwa').first().click().catch(() => {}); await page.waitForTimeout(400)
  await page.locator('aside button', { hasText: 'Marché Soleil Bastos' }).last().click(); await page.waitForTimeout(3000)
  ok(await nameInput.inputValue() === FULL[BASTOS] && (await page.getByTestId('settings-shop').innerText()).includes('Marché Soleil Bastos'),
    `en-tête → Bastos : formulaire rechargé (« ${await nameInput.inputValue()} »), la saisie d’Akwa n’est pas reprise`)
  const n = s.writes.length
  await saveBtn.click(); await page.waitForTimeout(2000)
  const save = s.writes.slice(n).find(w => w.path === '/api/shops/settings')
  ok(save && save.body.shop_id === BASTOS && save.body.name === FULL[BASTOS], `enregistrer → ${save ? FULL[save.body.shop_id] : '(aucun envoi)'}, nom « ${save?.body.name} » (intercepté)`)
  ok(s.errors.length === 0, `aucune erreur JavaScript${s.errors.length ? ' : ' + s.errors.join(' | ') : ''}`)
  await s.browser.close()

  console.log('\n5. Compte à une seule boutique (caissier d’Alpha)')
  process.env.CAPTURE_EMAIL = 'stocshopci@gmail.com'
  delete require.cache[require.resolve('./lib/capture.js')]
  Object.assign(capture, require('./lib/capture.js'))
  s = await open('sales/new'); page = s.page
  await page.locator('[data-tour="pos-grid"]').waitFor({ timeout: 20000 }).catch(() => {})
  ok(await page.getByTestId('pos-pick-shop').count() === 0 && await page.locator('[data-tour="pos-grid"]').count() === 1 && !(await page.locator('main').getByText('Vendre dans').count()),
    'caisse ouverte directement, sans question ni sélecteur de boutique')
  await s.browser.close()
  s = await open('settings'); page = s.page
  ok(await page.getByTestId('settings-pick-shop').count() === 0 && await page.getByTestId('settings-shop').count() === 0, 'Paramètres : ni choix ni bandeau de boutique')
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
