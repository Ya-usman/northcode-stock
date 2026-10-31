// Étape 15 du Stock (31 oct. 2026) : stock sans vente, ancienneté, surstock, dernière vente, délai de grâce.
// LECTURE SEULE, serveur local, Boutique Alpha (propriétaire), fr / en / ha, téléphone + ordinateur.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/stock-flow.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const num = s => Number((String(s).match(/\d+/) || [NaN])[0])

async function openFromPriority(page, locale, key) {
  await page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByTestId('stock-priorities').waitFor({ timeout: 60000 }); await wait(6000)
  if (await page.getByTestId('stock-priorities-toggle').count()) { await page.getByTestId('stock-priorities-toggle').click(); await wait(500) }
  const row = page.locator(`[data-priority="${key}"]`)
  if (!(await row.count())) return null
  const text = await row.innerText()
  await row.click(); await page.waitForURL(/\/stock\/products/, { timeout: 30000 }); await wait(12000)
  return text
}

;(async () => {
  // Produits récents d'Alpha (moins de 30 jours) avec du stock : jamais « sans vente » (délai de grâce)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: recent } = await db.from('products').select('name').eq('shop_id', ALPHA).eq('is_active', true).gt('quantity', 0).gte('created_at', since)
  const recentNames = (recent || []).map(p => p.name.trim())
  console.log(`Alpha : ${recentNames.length} produit(s) récent(s) avec stock`)

  for (const [locale, width, height] of [['fr', 390, 844], ['en', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    const desktop = width > 1000
    console.log(`\n${locale} · ${desktop ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/(stock|products|sales)/.test(r.url())) writes.push(r.url()) })

    // Vue d'ensemble : carte Stock dormant (ancienneté) puis liste « Sans vente (30 j) »
    await page.goto(`${BASE}/${locale}/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByTestId('stock-priorities').waitFor({ timeout: 60000 }); await wait(8000)
    const mainText = await page.locator('main').innerText()
    const oldWord = { fr: 'depuis plus de 90 jours', en: 'for more than 90 days', ha: 'fiye da kwanaki 90' }[locale]
    ok(mainText.includes(oldWord), `carte Stock dormant : ancienneté affichée (« ${(mainText.match(new RegExp('[^\\n]*' + oldWord + '[^\\n]*')) || [''])[0].trim()} »)`)

    const dormantText = await openFromPriority(page, locale, 'dormant')
    ok(!!dormantText, 'priorité « stock dormant » présente')
    if (desktop) { await page.getByTitle(m.products.view_table).first().click().catch(() => {}); await wait(2000) }
    const items = desktop ? page.locator('tbody tr') : page.locator('[data-product-card]')
    const nD = await items.count()
    const nLast = await page.locator('[data-last-sale]').count()
    ok(nD > 0 && nLast === nD, `liste « ${m.products.card_dormant} » : ${nD} produit(s), dernière vente sur chacun (${nLast})`)
    const lasts = await page.locator('[data-last-sale]').allInnerTexts()
    const okTexts = lasts.every(x => /\d/.test(x) || x === m.products.last_sale_over_year)
    ok(okTexts, `phrases de dernière vente (« ${lasts.slice(0, 2).join(' » / « ')} »)`)
    const filterLabel = await page.getByTestId('filter-status').innerText().catch(() => '')
    ok(filterLabel.includes(m.products.card_dormant.slice(0, 8)), `filtre renommé (« ${filterLabel.trim()} »)`)
    const listText = await page.locator('main').innerText()
    ok(recentNames.every(n => !listText.includes(n)), `délai de grâce : aucun des ${recentNames.length} produits récents dans la liste`)
    await page.screenshot({ path: `${OUT}/flow-dormant-${locale}${desktop ? '-desk' : ''}.png` })
    // Fiche d'un produit sans vente : dernière vente
    if (!desktop) {
      await items.first().locator('[data-product-name]').click(); await wait(4000)
      const ls = page.getByTestId('product-detail-last-sale')
      await ls.waitFor({ timeout: 20000 }).catch(() => {})
      ok((await ls.innerText().catch(() => '')).length > 0, `fiche : « ${await ls.innerText().catch(() => '')} »`)
      await page.keyboard.press('Escape'); await wait(600)
    }

    // Surstock : chiffre de la priorité = liste filtrée = pastilles
    const surText = await openFromPriority(page, locale, 'surstock')
    ok(!!surText && /6/.test(surText), `priorité surstock (« ${(surText || '').split('\n')[0]} »)`)
    if (desktop) { await page.getByTitle(m.products.view_table).first().click().catch(() => {}); await wait(2000) }
    const nS = await (desktop ? page.locator('tbody tr') : page.locator('[data-product-card]')).count()
    const nBadge = await page.locator('[data-surstock]').count()
    ok(nS === num(surText) && nBadge === nS, `liste surstock : ${nS} produit(s) = priorité (${num(surText)}), pastille sur chacun (${nBadge})`)
    ok((await page.locator('[data-surstock]').first().innerText()) === m.products.surstock_badge, 'pastille traduite')
    if (!desktop) {
      await page.locator('[data-product-card]').first().locator('[data-product-name]').click(); await wait(4000)
      const note = page.getByTestId('product-detail-surstock')
      await note.waitFor({ timeout: 20000 }).catch(() => {})
      ok((await note.innerText().catch(() => '')) === m.products.surstock_note, 'fiche : note de surstock')
      await page.keyboard.press('Escape'); await wait(600)
    }

    ok(writes.length === 0, `aucune écriture (${writes.length})`)
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
