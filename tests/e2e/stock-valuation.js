// Étape 7 du Stock (31 oct. 2026) : Stock › Valorisation. LECTURE SEULE, serveur local, Boutique Alpha.
//  - propriétaire : chiffres de la page = recalcul indépendant depuis la base (coût moyen, FIFO par lot, vente,
//    produits sans prix d'achat, lots au prix éloigné du coût moyen), fr / en / ha, téléphone + ordinateur ;
//  - caissier (sans le prix d'achat) : ni onglet, ni chiffres ; la route serveur refuse (403).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/stock-valuation.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OWNER = 'admin@northcode.ng', CASHIER = 'stocshopci@gmail.com'
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const digits = s => Number(String(s).replace(/[^\d]/g, ''))

;(async () => {
  // Recalcul indépendant (même définition que la route, écrit à part)
  const { data: ps } = await db.from('products').select('id, quantity, buying_price, selling_price').eq('shop_id', ALPHA).eq('is_active', true)
  const { data: bs } = await db.from('product_batches').select('product_id, quantity, buying_price, received_at, created_at').eq('shop_id', ALPHA).gt('quantity', 0)
  let average = 0, fifo = 0, selling = 0, unknown = 0, mismatch = 0, products = 0
  for (const p of ps) {
    const qty = Math.max(0, p.quantity); if (!qty) continue
    products++
    const avg = Number(p.buying_price) || 0
    const lots = bs.filter(b => b.product_id === p.id).sort((x, y) => (Date.parse(y.received_at || y.created_at) || 0) - (Date.parse(x.received_at || x.created_at) || 0))
    let left = qty, f = 0
    for (const l of lots) { const q = Math.min(l.quantity, left); if (q <= 0) break; f += q * (Number(l.buying_price) > 0 ? Number(l.buying_price) : avg); left -= q }
    f += left * avg
    average += qty * avg; fifo += f; selling += qty * (Number(p.selling_price) || 0)
    if (avg <= 0) unknown++
    if (avg > 0 && Math.abs(f - qty * avg) > 0.05 * qty * avg) mismatch++
  }
  console.log(`Alpha (base) : coût moyen ${Math.round(average)}, FIFO ${Math.round(fifo)}, vente ${Math.round(selling)}, ${unknown} sans prix, ${mismatch} écart(s) de lots`)

  for (const [locale, width, height] of [['fr', 390, 844], ['en', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    const desktop = width > 1000
    console.log(`\n${locale} · ${desktop ? 'ordinateur' : 'téléphone'} · propriétaire`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale, email: OWNER })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    await page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(5000)
    const tab = page.getByTestId('stock-tabs').getByText(m.nav.valuation, { exact: true })
    ok(await tab.count() === 1, `onglet « ${m.nav.valuation} » visible`)
    await tab.click(); await page.waitForURL(/\/stock\/valuation/, { timeout: 30000 }); await page.getByTestId('valuation-average').waitFor({ timeout: 60000 }); await wait(1500)
    const val = async id => digits(await page.getByTestId(id).locator('[data-value]').innerText())
    ok(await val('valuation-average') === Math.round(average), `coût moyen = base (${await val('valuation-average')})`)
    ok(Math.abs(await val('valuation-fifo') - Math.round(fifo)) <= 1, `FIFO = base (${await val('valuation-fifo')})`)
    ok(Math.abs(await val('valuation-selling') - Math.round(selling)) <= 1, `valeur de vente = base (${await val('valuation-selling')})`)
    ok(Math.abs(await val('valuation-margin') - Math.round(selling - average)) <= 1, 'marge potentielle = vente − coût moyen')
    const unk = await page.getByTestId('valuation-unknown').innerText().catch(() => '')
    ok(unknown === 0 ? unk === '' : unk.includes(String(unknown)), `produits sans prix d'achat signalés (${unknown})`)
    const mis = await page.getByTestId('valuation-mismatch').innerText().catch(() => '')
    ok(mismatch === 0 ? mis === '' : mis.startsWith(String(mismatch)) || mis.includes(` ${mismatch} `) || mis.includes(`Kaya ${mismatch}`), `lots au prix éloigné du coût moyen signalés (${mismatch})`)
    const cats = await page.getByTestId('valuation-categories').locator('li').count()
    ok(cats > 0 && await page.getByTestId('valuation-top').locator('li').count() === Math.min(10, products), 'répartition par catégorie et 10 produits les plus lourds')
    const txt = await page.locator('main').innerText()
    ok(!/[—–]/.test(txt), 'aucun tiret long')
    await page.screenshot({ path: `${OUT}/valuation-${locale}${desktop ? '-desk' : ''}.png`, fullPage: !desktop })
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
    await s.browser.close()
  }

  console.log('\nfr · caissier (sans le prix d’achat)')
  const c = await session({ width: 390, height: 844, scale: 1, locale: 'fr', email: CASHIER })
  await c.page.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  ok(await c.page.getByTestId('stock-tabs').getByText('Valorisation', { exact: true }).count() === 0, 'caissier : pas d’onglet Valorisation')
  await c.page.goto(`${BASE}/fr/stock/valuation`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  ok(await c.page.getByTestId('valuation-average').count() === 0 && (await c.page.getByTestId('valuation-no-access').count()) === 1, 'caissier : aucun chiffre par l’adresse directe')
  const r = await c.page.evaluate(async shop => (await fetch(`/api/stock/valuation?shop_ids=${shop}`)).status, ALPHA)
  ok(r === 403, `caissier : la route serveur refuse (${r})`)
  await c.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
