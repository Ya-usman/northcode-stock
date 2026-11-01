// Étape 16 du Stock (1er nov. 2026) : kits assemblés à l'écran. LECTURE SEULE (rien n'est assemblé), serveur local,
// Boutique Alpha, compte propriétaire. Repose sur « TEST Panier cadeau (rt-200) » = 2 savons + 1 parfum (rt-200-kits).
//  - fiche du kit : composition (2 lignes, disponible), nombre de kits assemblables = celui du serveur, boutons ;
//  - éditeur de composition : s'ouvre avec les 2 composants, se referme sans enregistrer ;
//  - fiche d'un produit simple : « Composer un kit » ;
//  - haoussa : textes traduits.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/kits-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'admin@northcode.ng'
process.env.PIN_SHOP = 'a0000000-0000-0000-0000-000000000001' // Boutique Alpha
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const KIT = 'TEST Panier cadeau (rt-200)', SOAP = 'TEST Savon kit (rt-200)'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

;(async () => {
  const { data: comps } = await db.from('product_kit_components').select('quantity, products!product_kit_components_component_product_id_fkey(name, quantity)')
    .eq('kit_product_id', (await db.from('products').select('id').eq('name', KIT).single()).data.id)
  const expected = Math.min(...comps.map(c => Math.floor(c.products.quantity / c.quantity)))
  console.log(`Kit TEST : ${comps.length} composants, ${expected} assemblable(s) attendu(s)`)

  for (const [locale, width, height] of [['fr', 390, 844], ['ha', 390, 844], ['fr', 1366, 900]]) {
    console.log(`\n${locale} · ${width > 1000 ? 'ordinateur' : 'téléphone'}`)
    const m = require(`../../messages/${locale}.json`)
    const s = await session({ width, height, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /\/api\/products/.test(r.url())) writes.push(r.url()) })
    const drawer = page.locator('[data-testid="product-detail"]')

    await page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
    await page.getByLabel(m.products.search_placeholder).first().fill('Panier cadeau'); await wait(1500)
    await page.locator('[data-product-name]', { hasText: KIT }).first().click()
    await drawer.waitFor({ timeout: 15000 })
    const sec = drawer.getByTestId('product-kit')
    await sec.getByTestId('kit-components').waitFor({ timeout: 20000 }).catch(() => {})
    const lines = await sec.locator('[data-testid="kit-components"] li').allInnerTexts()
    ok(lines.length === 2 && lines.some(l => /^2 × TEST Savon/.test(l)) && lines.some(l => /^1 × TEST Parfum/.test(l)), `composition : ${lines.map(l => l.replace(/\s+/g, ' ')).join(' | ')}`)
    const ass = (await sec.getByTestId('kit-assemblable').innerText()).trim()
    ok(new RegExp(String(expected)).test(ass), `kits assemblables : « ${ass} »`)
    ok(await sec.getByTestId('kit-assemble').count() === 1 && await sec.getByTestId('kit-disassemble').count() === 1, 'boutons Assembler / Désassembler')
    await sec.screenshot({ path: `${OUT}/kits-${locale}-${width}-fiche.png` })
    await sec.getByTestId('kit-edit').click()
    const ed = drawer.getByTestId('kit-editor')
    await ed.waitFor({ timeout: 10000 }).catch(() => {})
    ok(await ed.locator('li').count() === 2, 'éditeur : 2 composants')
    await ed.getByRole('button', { name: m.kits.cancel }).click(); await wait(300)
    ok(await drawer.getByTestId('kit-editor').count() === 0, 'éditeur refermé sans enregistrer')
    if (locale === 'ha') ok(!/Kit assemblable|Assembler|Désassembler|Composition/.test(await sec.innerText()), 'haoussa : aucun texte français')
    for (let i = 0; i < 3 && (await drawer.count()); i++) { await page.keyboard.press('Escape'); await wait(500) }

    // Produit simple : « Composer un kit »
    await page.getByLabel(m.products.search_placeholder).first().fill('Savon kit'); await wait(1500)
    await page.locator('[data-product-name]', { hasText: SOAP }).first().click()
    await drawer.waitFor({ timeout: 15000 })
    await drawer.getByTestId('kit-make').waitFor({ timeout: 20000 }).catch(() => {})
    ok(await drawer.getByTestId('kit-make').count() === 1, `produit simple : « ${m.kits.make_kit} »`)
    ok(!writes.length, `aucune écriture envoyée (${writes.length})`, writes)
    ok(!errors.length, 'aucune erreur JavaScript', errors)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
