// Page Aide (31 oct. 2026) : questions fréquentes + manuel illustré traduits, captures par langue. LECTURE SEULE.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/help-page.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

;(async () => {
  for (const locale of ['fr', 'en', 'ha']) {
    const msg = require(`../../messages/${locale}.json`).help_page
    const nQ = msg.faq.reduce((n, g) => n + g.items.length, 0)
    const nB = msg.manual.reduce((n, s) => n + s.blocks.length, 0)
    console.log(`\n${locale}`)
    const s = await session({ width: 390, height: 844, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    await page.goto(`${BASE}/${locale}/help`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByTestId('help-faq-question').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500)

    ok(await page.getByTestId('help-faq-question').count() === nQ, `${nQ} questions affichées`)
    ok(await page.getByTestId('help-faq-group').count() === msg.faq.length, `${msg.faq.length} groupes`)
    const q = page.getByTestId('help-faq-question').first()
    await q.click(); await page.waitForTimeout(300)
    ok(await q.getAttribute('aria-expanded') === 'true', 'une question s’ouvre au toucher')
    const firstAnswer = msg.faq[0].items[0].a.replace(/\*\*/g, '')
    ok((await page.locator('main').innerText()).includes(firstAnswer.slice(0, 40)), 'réponse affichée, gras rendu sans « ** »')
    ok(await page.locator('main strong').count() > 0, 'termes en gras rendus en <strong>')
    ok((await page.getByText('support@stockshop.tech').count()) > 0, 'contact support affiché')

    await page.getByTestId('help-tabs').getByRole('button').nth(1).click().catch(async () => {
      await page.getByTestId('help-tabs').locator('button, [role="tab"]').nth(1).click()
    })
    await page.getByTestId('help-manual-block').first().waitFor({ timeout: 20000 })
    ok(await page.getByTestId('help-manual-block').count() === nB, `${nB} blocs du manuel`)
    ok(await page.locator('main a[href^="#help-"]').count() === msg.manual.length, `sommaire : ${msg.manual.length} sections`)
    // Images : chargées une à une (chargement différé), toutes dans la langue de la page
    const imgs = page.getByTestId('help-manual-block').locator('img')
    let loaded = 0, rightLocale = 0
    for (let i = 0; i < await imgs.count(); i++) {
      const img = imgs.nth(i)
      await img.scrollIntoViewIfNeeded()
      // Pas de waitForFunction : il évalue une chaîne, refusée par la CSP de l'application (« unsafe-eval »)
      let r = { w: 0, src: '' }
      for (let t = 0; t < 40 && !r.w; t++) {
        await page.waitForTimeout(250)
        r = await img.evaluate(el => ({ w: el.complete ? el.naturalWidth : 0, src: el.currentSrc || el.src }))
      }
      if (r.w > 0) loaded++
      if (decodeURIComponent(r.src).includes(`/manual/${locale}/`)) rightLocale++
    }
    ok(loaded === nB, `images chargées : ${loaded}/${nB}`)
    ok(rightLocale === nB, `images dans la langue « ${locale} » : ${rightLocale}/${nB}`)
    const text = await page.locator('main').innerText()
    ok(!text.includes('**'), 'aucun « ** » visible')
    ok(!/[—–]/.test(text), 'aucun tiret long')
    await page.locator('main a[href^="#help-"]').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/help-${locale}.png` })
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
