// Dates haoussa (31 oct. 2026) : sur les écrans où le français apparaissait en haoussa, plus aucun nom de jour ou de
// mois français ou anglais ; le français et l'anglais gardent leurs dates habituelles. LECTURE SEULE, serveur local,
// compte vitrine Marché Soleil (Akwa), téléphone.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/hausa-dates-screens.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

// « mai » est exclu : c'est aussi un mot haoussa courant (« Mai Sayarwa »)
const FR = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre|janv\.|févr\.|avr\.|juil\.|sept\.|oct\.|nov\.|déc\.)\b/i
const EN = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|April|June|July|August|September|October|November|December|ago|about)\b/
const HA = /\b(Lahadi|Litinin|Talata|Laraba|Alhamis|Jumma'a|Asabar|Janairu|Faburairu|Maris|Afirilu|Mayu|Yuni|Yuli|Agusta|Satumba|Oktoba|Nuwamba|Disamba|Jan|Fab|Mar|Afi|May|Yun|Yul|Agu|Sat|Okt|Nuw|Dis)\b/

// Écrans où une date en toutes lettres s'affiche (relevé du 31 oct. : tableau de bord, caisse, dépenses, équipe, boutiques, mouvements)
const SCREENS = [
  ['dashboard', null], ['caisse', null], ['expenses', null], ['team', null], ['shops', null], ['stock/movements', null], ['sales/history', null],
]

;(async () => {
  for (const locale of ['ha', 'fr', 'en']) {
    console.log(`\n${locale}`)
    const s = await session({ width: 390, height: 844, scale: 1, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    let haWords = 0
    for (const [route] of SCREENS) {
      await page.goto(`${BASE}/${locale}/${route}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
      // Noms de boutiques et données saisies du compte vitrine (« Loyer de la boutique, octobre ») : pas des dates
      const txt = (await page.locator('main').innerText().catch(() => '')).replace(/Marché Soleil[^\n]*/g, '').replace(/[^\n]*Loyer[^\n]*/g, '')
      if (locale === 'ha') {
        const fr = txt.match(FR), en = txt.match(EN)
        ok(!fr && !en, `${route} : aucun mot de date français ou anglais${fr ? ' (trouvé « ' + fr[0] + ' »)' : ''}${en ? ' (trouvé « ' + en[0] + ' »)' : ''}`)
        if (HA.test(txt)) haWords++
        if (route === 'caisse' || route === 'team') await page.screenshot({ path: `${OUT}/ha-dates-${route.replace('/', '-')}.png` })
      } else if (locale === 'fr') {
        if (route === 'dashboard') ok(FR.test(txt), `${route} : dates françaises inchangées (« ${(txt.match(FR) || [''])[0]} »)`)
      } else if (route === 'dashboard') {
        ok(EN.test(txt) || /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Oct|Nov)\b/.test(txt), `${route} : dates anglaises inchangées`)
      }
    }
    if (locale === 'ha') ok(haWords >= 3, `noms haoussa présents sur ${haWords} écran(s)`)
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
