// Périmés : « Disponible » sans les lots périmés, confirmation en caisse. LECTURE SEULE : compilation locale, compte vitrine,
// écritures bloquées. Aucun lot du compte n'étant périmé aujourd'hui, le lot de « Pain de campagne » (20 unités) est présenté
// comme périmé DANS LE NAVIGATEUR seulement (réponses interceptées) ; la base n'est pas touchée. Aucune vente n'est validée.
// Usage : CAPTURE_BASE=http://localhost:3000 node stock-expired.js
const fs = require('fs')
const V = __dirname + '/out/vitrine/'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'; process.env.CAPTURE_TZ = 'Africa/Douala'
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out/stock-expired'; fs.mkdirSync(OUT, { recursive: true })
const AKWA = fs.readFileSync(V + 'akwa-id.txt', 'utf8').trim()
const state = JSON.parse(fs.readFileSync(V + 'state.json', 'utf8'))
const PAIN = state.products.akwa.pain
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : extra) }
const W = {
  fr: { expired: '20 périmés', title: 'Lot périmé', action: 'Vendre quand même', cancel: /Annuler/, desc: 'a dépassé sa date de péremption' },
  en: { expired: '20 expired', title: 'Expired batch', action: 'Sell anyway', cancel: /Cancel/, desc: 'past its expiry date' },
  // Mise à jour (14 oct. 2026) — ancienne hypothèse : titre haoussa « Lot ya ƙare ». Réel : « Lodi ya ƙare » — glossaire
  // haoussa (lot = « lodi », règle contrôlée au build par check-glossary). Ne JAMAIS revenir à l'ancien terme.
  ha: { expired: '20 sun ƙare', title: 'Lodi ya ƙare', action: 'Sayar duk da haka', cancel: /Soke|Cancel|Annuler/, desc: 'ya wuce ranar' },
}
async function open(locale, width, height, expiredQty = 20) {
  const s = await session({ width, height, scale: 1, locale })
  await s.page.context().addInitScript(([shop]) => { try { localStorage.setItem('active_shop_id', shop); localStorage.setItem('stock_table_columns', JSON.stringify(['physical'])) } catch {} }, [AKWA])
  // Lot de pain présenté comme périmé (navigateur seulement)
  await s.page.route(/\/rest\/v1\/product_batches\?/, async route => {
    const url = route.request().url()
    if (route.request().method() !== 'GET') return route.fallback()
    if (/expiry_date=lt\./.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ product_id: PAIN, quantity: expiredQty }]) })
    const res = await route.fetch()
    let body = await res.text()
    try { const j = JSON.parse(body); if (Array.isArray(j)) body = JSON.stringify(j.map(b => (b.product_id === PAIN && b.expiry_date ? { ...b, expiry_date: '2026-10-10' } : b))) } catch {}
    return route.fulfill({ response: res, body })
  })
  return s
}
const rowOf = (page, name) => page.evaluate(nm => { const tr = [...document.querySelectorAll('main table tbody tr')].find(x => x.innerText.includes(nm)); return tr ? tr.innerText.replace(/\s+/g, ' ') : null }, name)

// Mise à jour (23 oct. 2026) — ancienne hypothèse : données de la vitrine figées (seules les mangues en rupture, ail à 28).
// Réel : la vitrine sert aussi aux démonstrations (ventes réelles des 15 et 22 oct.). Les attentes sont relues en base
// (LECTURE SEULE) au lancement : ruptures réelles d'Akwa et stock de l'ail.
const REF = { out: [], ail: null }
async function loadRef() {
  const ROOT = require('path').resolve(__dirname, '../..'); const env = {}
  for (const l of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
  const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data } = await db.from('products').select('name, quantity').eq('shop_id', AKWA).eq('is_active', true)
  REF.out = data.filter(p => Number(p.quantity) <= 0).map(p => p.name)
  REF.ail = Number(data.find(p => p.name === 'Ail 250 g')?.quantity)
  console.log(`Repères relus : ruptures d'Akwa = ${REF.out.join(', ') || 'aucune'} ; ail = ${REF.ail}`)
}
const rupturesIs = (text, n) => new RegExp(`\\| ${n} \\| Ruptures`).test(text)
;(async () => {
  await loadRef()
  console.log('Base :', BASE)

  // ── Statut jugé sur le disponible : tout le stock de pain périmé (78 sur 78, simulé) ──
  console.log('\nFR · statut quand tout le stock est périmé (1440×900)')
  {
    const { browser, page } = await open('fr', 1440, 900, 78)
    await page.goto(`${BASE}/fr/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
    const pain = await rowOf(page, 'Pain de campagne')
    check('pain : 0 disponible, « 78 périmés », statut « Rupture de stock » (plus « En stock »)', !!pain && /(^|\D)0\s?pièce/.test(pain) && pain.includes('78 périmés') && /Rupture de stock/.test(pain) && !/En stock/.test(pain), pain)
    const ail = await rowOf(page, 'Ail 250 g')
    check('produit sain : toujours « En stock »', !!ail && /En stock/.test(ail), ail)
    // Filtre « Rupture » : le pain y apparaît avec les mangues
    await page.goto(`${BASE}/fr/stock/products?status=out`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
    const names = await page.evaluate(() => [...document.querySelectorAll('main table tbody tr')].map(tr => tr.children[1].innerText.split('\n')[0].trim()))
    const expectOut = [...new Set([...REF.out, 'Pain de campagne'])]
    check(`filtre « Rupture » : le pain + les ruptures réelles (${expectOut.length})`, names.length === expectOut.length && expectOut.every(e => names.some(n => n.startsWith(e))), names.join(' | '))
    await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
    const text = await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
    check(`Vue d'ensemble : ${REF.out.length + 1} ruptures (${REF.out.length} sans le pain périmé)`, rupturesIs(text, REF.out.length + 1), (text.match(/[^|]*\| Ruptures/) || [''])[0])
    await browser.close()
  }
  {
    // Sans lot périmé simulé au-delà de 20 : le pain reste « En stock », 1 seule rupture
    const { browser, page } = await open('fr', 1440, 900, 20)
    await page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
    const text = await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
    check(`Vue d'ensemble : ${REF.out.length} rupture(s) quand il reste du disponible`, rupturesIs(text, REF.out.length), (text.match(/[^|]*\| Ruptures/) || [''])[0])
    await browser.close()
  }
  for (const locale of ['fr', 'en', 'ha']) {
    const w = W[locale]
    // ── Stock › Produits, ordinateur ──
    console.log(`\n${locale.toUpperCase()} · Stock › Produits (1440×900)`)
    let { browser, page } = await open(locale, 1440, 900)
    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
    const pain = await rowOf(page, 'Pain de campagne')
    check('pain : 58 disponibles (78 en rayon − 20 périmés), mention « ' + w.expired + ' »', !!pain && /(^|\D)58(\D|$)/.test(pain) && pain.includes(w.expired), pain)
    check('pain : « Stock physique » reste 78', !!pain && /\b78\b/.test(pain), pain)
    const ail = await rowOf(page, 'Ail 250 g')
    check('produit sans lot périmé : disponible = physique, aucune mention', !!ail && new RegExp(`\\b${REF.ail}\\b`).test(ail) && !/périm|expired|ƙare/.test(ail.replace(/Péremption|Expir\w+ \d|Périme le/gi, '')), ail)
    check('pas de débordement de la page', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1)
    if (locale === 'fr') {
      await page.screenshot({ path: `${OUT}/fr-ordinateur-produits.png` })
      // « 20 périmés » ouvre les lots du produit
      await page.locator('main table tbody tr', { hasText: 'Pain de campagne' }).getByRole('button', { name: w.expired }).click(); await page.waitForTimeout(2500)
      check('clic sur « 20 périmés » : ouvre les lots du produit', await page.evaluate(() => !!document.querySelector('[role="dialog"]') && /Pain de campagne/.test(document.querySelector('[role="dialog"]').innerText)))
    }
    await browser.close()

    // ── Stock › Produits, téléphone (cartes) ──
    if (locale !== 'ha') {
      console.log(`${locale.toUpperCase()} · Stock › Produits (390×844)`)
      ;({ browser, page } = await open(locale, 390, 844))
      await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(9000)
      await page.locator('main input').first().fill('Pain'); await page.waitForTimeout(2500)
      const card = await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
      check('carte téléphone : 58 disponibles et « ' + w.expired + ' »', /\b58\b/.test(card) && card.includes(w.expired), card.slice(-300))
      check('carte téléphone : pas de débordement', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1)
      if (locale === 'fr') await page.screenshot({ path: `${OUT}/fr-telephone-produits.png` })
      await browser.close()
    }

    // ── Caisse ──
    for (const [name, width, height] of locale === 'fr' ? [['ordinateur', 1440, 900], ['téléphone', 390, 844], ['tablette portrait', 820, 1180]] : [['ordinateur', 1440, 900]]) {
      console.log(`${locale.toUpperCase()} · Caisse (${name})`)
      ;({ browser, page } = await open(locale, width, height))
      const writes = []
      page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/sales|rpc\/complete_sale/.test(r.url())) writes.push(r.url()) })
      await page.goto(`${BASE}/${locale}/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(10000)
      const card = n => page.locator('[data-tour="pos-grid"] > div[role="button"]', { hasText: n }).first()
      // Nombre de lignes du panier, sans dépendre de la langue : sur grand écran, une corbeille par ligne (+ celle de « Vider le panier ») ;
      // sur écran étroit, le chiffre de la barre du panier
      const cartCount = () => page.evaluate(wide => {
        if (wide) {
          // En-tête du panier : icône de panier suivie de « N articles » (le premier nombre, quelle que soit la langue)
          for (const svg of document.querySelectorAll('main svg.lucide-shopping-cart')) { const txt = (svg.parentElement.innerText || '').trim(); const m = txt.length < 40 && txt.match(/(\d+)/); if (m) return Number(m[1]) }
          return 0
        }
        const bar = [...document.querySelectorAll('div')].find(d => String(d.className).includes('fixed bottom-16 sm:bottom-0'))
        const m = bar && bar.innerText.match(/\d+/); return m ? Number(m[0]) : 0
      }, width >= 1024)
      const dialog = () => page.evaluate(() => { const d = document.querySelector('[role="dialog"], [role="alertdialog"]'); return d ? d.innerText.replace(/\n+/g, ' | ') : null })
      // Produit sain : aucun message
      await card('Ananas').click(); await page.waitForTimeout(900)
      check('produit sans lot périmé : ajouté sans question', (await dialog()) === null && (await cartCount()) === 1, String(await dialog()))
      // Produit périmé : question, puis « Annuler » n'ajoute rien
      await card('Pain de campagne').click(); await page.waitForTimeout(900)
      let d = await dialog()
      check('pain : la question « ' + w.title + ' » s\'affiche, avec le nom du produit', !!d && d.includes(w.title) && d.includes('Pain de campagne') && d.includes(w.desc) && d.includes(w.action), d)
      if (locale === 'fr' && name !== 'ordinateur') await page.screenshot({ path: `${OUT}/fr-${width}-question.png` })
      check('la question tient dans l\'écran', await page.evaluate(() => { const el = document.querySelector('[role="dialog"], [role="alertdialog"]'); if (!el) return false; const b = el.getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1 }))
      await page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({ hasText: w.cancel }).first().click(); await page.waitForTimeout(700)
      check('« Annuler » : rien n\'est ajouté', (await dialog()) === null && (await cartCount()) === 1, String(await cartCount()))
      // Redemandé, puis « Vendre quand même » ajoute
      await card('Pain de campagne').click(); await page.waitForTimeout(900)
      await page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({ hasText: w.action }).first().click(); await page.waitForTimeout(900)
      check('« ' + w.action + ' » : le produit est ajouté (pas de blocage)', (await dialog()) === null && (await cartCount()) === 2, String(await cartCount()))
      // Même panier : plus de question
      await card('Pain de campagne').click(); await page.waitForTimeout(900)
      check('même panier : pas redemandé pour ce produit', (await dialog()) === null)
      check('aucune vente envoyée pendant le test', writes.length === 0, writes.join(' '))
      await browser.close()
    }
  }
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
