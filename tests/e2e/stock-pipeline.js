// Étape 5A (Stock à venir) — vérifications à l'écran et par la route. LECTURE SEULE : compilation locale, compte vitrine,
// écritures bloquées par capture.js. Les captures servent seulement de preuve de test (pas de visuels).
// Usage : CAPTURE_BASE=http://localhost:3000 node stock-pipeline.js
const fs = require('fs')
const V = __dirname + '/out/vitrine/'
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const OUT = __dirname + '/out/stock-pipeline'; fs.mkdirSync(OUT, { recursive: true })
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : extra) }
const AKWA = fs.readFileSync(V + 'akwa-id.txt', 'utf8').trim()
const state = JSON.parse(fs.readFileSync(V + 'state.json', 'utf8'))
const WORDS = {
  fr: { incoming: 'Stock à venir', order: 'En commande', transit: 'En transit', units110: '110 | Unités en commande', units34: '34 | Unités en transit', cardOrderLabel: 'Unités en commande', cardTransitLabel: 'Unités en transit', po1: '1 bon de commande envoyé', tr1: '1 transfert à recevoir', none: 'Rien en route', eggs: 'Œufs (plateau de 30)', water: 'Eau minérale 1,5 L', cardOrder: '+20 en commande', explain: 'Disponible = Physique' },
  en: { incoming: 'Incoming stock', order: 'On order', transit: 'In transit', units110: '110 | Units on order', units34: '34 | Units in transit', cardOrderLabel: 'Units on order', cardTransitLabel: 'Units in transit', po1: '1 purchase order sent', tr1: '1 transfer to receive', none: 'Nothing on the way', eggs: 'Œufs (plateau de 30)', water: 'Eau minérale 1,5 L', cardOrder: '+20 on order', explain: 'Available = Physical' },
  ha: { incoming: 'Kayan da ke zuwa', order: 'An yi oda', transit: 'A kan hanya', units110: '110 | Guda da aka yi oda', units34: '34 | Guda a kan hanya', cardOrderLabel: 'Guda da aka yi oda', cardTransitLabel: 'Guda a kan hanya', po1: 'Odar saye 1 da aka aika', tr1: 'Canja-wuri 1 da za a karɓa', none: 'Babu abin da ke kan hanya', eggs: 'Œufs (plateau de 30)', water: 'Eau minérale 1,5 L', cardOrder: '+20 an yi oda', explain: 'Akwai = Kaya a hannu' },
}
async function cookieFor(email) {
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const v = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  return parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
}

;(async () => {
  process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'; process.env.CAPTURE_TZ = 'Africa/Douala'
  const { session, BASE } = require('./lib/capture.js')
  const { data: bp } = await admin.from('products').select('shop_id').eq('id', Object.values(state.products.bastos)[0]).single()
  const BASTOS = bp.shop_id
  console.log('Base :', BASE)

  // ── Route : chiffres attendus sur le compte vitrine (1 transfert envoyé vers Bastos, 1 bon envoyé à Akwa) ──
  console.log('\nRoute /api/stock/pipeline')
  const owner = await cookieFor('ghislainx123@gmail.com')
  const get = async (cookie, ids) => { const res = await fetch(`${BASE}/api/stock/pipeline?shop_ids=${ids}`, { headers: { Cookie: cookie } }); return { status: res.status, json: await res.json().catch(() => ({})) } }
  let r = await get(owner, AKWA)
  check('Akwa : 110 unités en commande sur 1 bon, rien en transit', r.status === 200 && r.json.totals.onOrderUnits === 110 && r.json.totals.onOrderOrders === 1 && r.json.totals.inTransitUnits === 0, JSON.stringify(r.json.totals))
  check('Akwa : œufs +20, tomates +40, bananes +50', r.json.byProduct?.[state.products.akwa.oeufs]?.onOrder === 20 && r.json.byProduct?.[state.products.akwa.tomates]?.onOrder === 40 && r.json.byProduct?.[state.products.akwa.bananes]?.onOrder === 50, JSON.stringify(r.json.byProduct))
  r = await get(owner, BASTOS)
  check('Bastos : 34 unités en transit sur 1 transfert, tout rattaché', r.status === 200 && r.json.totals.inTransitUnits === 34 && r.json.totals.inTransitTransfers === 1 && r.json.totals.inTransitUnmatched === 0, JSON.stringify(r.json.totals))
  check('Bastos : eau +24 et savon +10, sur les produits de BASTOS', r.json.byProduct?.[state.products.bastos.eau]?.inTransit === 24 && r.json.byProduct?.[state.products.bastos.savon]?.inTransit === 10, JSON.stringify(r.json.byProduct))
  r = await get(owner, `${AKWA},${BASTOS}`)
  check('deux boutiques : totaux additionnés (34 en transit, 110 en commande)', r.json.totals?.inTransitUnits === 34 && r.json.totals?.onOrderUnits === 110, JSON.stringify(r.json.totals))
  // Autre entreprise : une boutique de la copie anglaise est refusée au propriétaire français
  const other = fs.readFileSync(V + 'akwa-english-id.txt', 'utf8').trim()
  r = await get(owner, other)
  check('boutique d\'une autre entreprise : refusée (403)', r.status === 403, String(r.status))
  r = await get(owner, `${AKWA},${other}`)
  check('boutique étrangère mêlée à la sienne : ignorée, chiffres d\'Akwa seuls', r.status === 200 && r.json.totals.onOrderUnits === 110, JSON.stringify(r.json.totals))
  r = await fetch(`${BASE}/api/stock/pipeline?shop_ids=${AKWA}`).then(async x => ({ status: x.status }))
  check('sans session : refusé (401)', r.status === 401, String(r.status))
  r = await get(await cookieFor('ghislainx123+fatou@gmail.com'), AKWA)
  check('caissière (Stock masqué) : refusée (403)', r.status === 403, String(r.status) + ' ' + JSON.stringify(r.json).slice(0, 80))
  r = await get(await cookieFor('ghislainx123+mariam@gmail.com'), BASTOS)
  check('gestionnaire de stock de Bastos : accès, avec ses droits de visibilité', r.status === 200 && typeof r.json.visible?.inTransit === 'boolean', String(r.status))
  console.log('       (gestionnaire de stock : transferts visibles', r.json.visible?.inTransit, '· commandes visibles', r.json.visible?.onOrder, ')')

  // ── Écrans ──
  const SIZES = [['telephone', 390, 844], ['tablette-portrait', 820, 1180], ['tablette-paysage', 1180, 820], ['ordinateur', 1440, 900]]
  for (const locale of ['fr', 'en', 'ha']) {
    const W = WORDS[locale]
    for (const [name, width, height] of SIZES) {
      if (locale !== 'fr' && !['telephone', 'ordinateur'].includes(name)) continue
      console.log(`\n${locale.toUpperCase()} · ${name} (${width}×${height})`)
      const { browser, page } = await session({ width, height, scale: 1, locale })
      const setShop = id => page.context().addInitScript(([shop]) => { try { localStorage.setItem('active_shop_id', shop); localStorage.setItem('dashboard_shop_filter', shop); localStorage.setItem('stock_table_columns', JSON.stringify(['physical', 'inTransit', 'onOrder'])) } catch {} }, [id])
      await setShop(AKWA)
      await page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000)
      let text = await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
      check('Vue d\'ensemble Akwa : section « Stock à venir », 110 unités en commande, 1 bon', text.includes(W.incoming) && text.includes(W.units110) && text.includes(W.po1), text.slice(0, 400))
      check('Vue d\'ensemble Akwa : en transit affiché sans rien en route', text.includes('0 | ' + W.cardTransitLabel) && text.includes(W.none), text.slice(0, 400))
      check('Vue d\'ensemble : pas de débordement', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1)
      const valueLines = await page.evaluate(label => { const card = [...document.querySelectorAll('main button')].find(b => b.innerText.includes(label)); const v = card && card.querySelector('p'); return v ? Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).fontSize)) : -1 }, W.cardOrderLabel)
      check('carte « En commande » : le chiffre tient sur une ligne', valueLines === 1, String(valueLines))
      if (locale === 'fr' || name === 'telephone') await page.screenshot({ path: `${OUT}/${locale}-${name}-vue.png`, fullPage: true })
      // Clic sur la carte « En commande » → bons de commande des fournisseurs
      await page.locator('main button').filter({ hasText: W.cardOrderLabel }).first().click(); await page.waitForTimeout(3500)
      check('carte « En commande » : ouvre les bons de commande', /\/suppliers\?view=purchase_orders/.test(page.url()), page.url())

      await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(8000)
      const isTable = await page.locator('main table').count() > 0
      if (isTable) {
        const head = await page.evaluate(() => [...document.querySelectorAll('main table thead th')].map(th => th.innerText.trim()))
        check('tableau : colonnes « En transit » et « En commande » présentes', head.includes(W.transit) && head.includes(W.order), head.join(' · '))
        const row = async n => page.evaluate(nm => { const tr = [...document.querySelectorAll('main table tbody tr')].find(x => x.innerText.includes(nm)); return tr ? tr.innerText.replace(/\s+/g, ' ') : null }, n)
        const eggs = await row(W.eggs)
        check('tableau : œufs « +20 » en commande', !!eggs && /\+20\b/.test(eggs), eggs)
        const garlic = await row('Ail 250 g')
        check('tableau : produit sans rien d\'attendu → 0 (pas de tiret)', !!garlic && !/\+\d/.test(garlic) && !/—\s*—/.test(garlic.split('F CFA').slice(1).join('')), garlic)
        check('tableau : pas de débordement de la page', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1)
        if (locale === 'fr') {
          await page.locator('main button').filter({ hasText: /Colonnes/ }).first().click(); await page.waitForTimeout(800)
          const pop = await page.evaluate(() => document.body.innerText)
          check('bouton Colonnes : « Réservé » proposé, avec l\'explication Disponible = Physique − Périmé − Réservé', pop.includes(W.explain) && /Réservé/.test(pop))
          await page.keyboard.press('Escape')
        }
      } else {
        const body = await page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
        check('cartes produits : « ' + W.cardOrder + ' » sur les œufs', body.includes(W.cardOrder), (body.match(/Œufs[^|]*\|[^|]*\|[^|]*\|[^|]*/) || [''])[0])
        check('cartes produits : pas de débordement', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1)
      }
      if (locale === 'fr' || name === 'telephone') await page.screenshot({ path: `${OUT}/${locale}-${name}-produits.png` })
      await browser.close()

      // Bastos : destination du transfert en route
      if (name === 'ordinateur' || (locale === 'fr' && name === 'telephone')) {
        const s2 = await session({ width, height, scale: 1, locale })
        await s2.page.context().addInitScript(([shop]) => { try { localStorage.setItem('active_shop_id', shop); localStorage.setItem('dashboard_shop_filter', shop); localStorage.setItem('stock_table_columns', JSON.stringify(['inTransit', 'onOrder'])) } catch {} }, [BASTOS])
        await s2.page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await s2.page.waitForTimeout(8000)
        text = await s2.page.evaluate(() => document.querySelector('main').innerText.replace(/\n+/g, ' | '))
        check('Vue d\'ensemble Bastos : 34 unités en transit, 1 transfert à recevoir', text.includes(W.units34) && text.includes(W.tr1), text.slice(0, 400))
        await s2.page.locator('main button').filter({ hasText: W.cardTransitLabel }).first().click(); await s2.page.waitForTimeout(3500)
        check('carte « En transit » : ouvre les transferts', /\/stock\/transfers/.test(s2.page.url()), s2.page.url())
        if (name === 'ordinateur') {
          await s2.page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await s2.page.waitForTimeout(8000)
          const water = await s2.page.evaluate(nm => { const tr = [...document.querySelectorAll('main table tbody tr')].find(x => x.innerText.includes(nm)); return tr ? tr.innerText.replace(/\s+/g, ' ') : null }, W.water)
          check('tableau Bastos : eau « +24 » en transit', !!water && /\+24\b/.test(water), water)
        }
        await s2.browser.close()
      }
    }
  }
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
