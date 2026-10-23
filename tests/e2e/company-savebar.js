// Paramètres › Entreprise — enregistrement visible : barre fixée en bas dès qu'un champ change (ordinateur ET
// téléphone, au-dessus de la barre de navigation), bandeau « Confirmer ce nom » → « Enregistrer ce nom » après
// modification. LECTURE SEULE : toute écriture est interceptée (corps relu, jamais envoyée).
// Bandeau vérifié sur Alpha (nom non confirmé) ; état du nom relu en base, jamais supposé.
// Usage : CAPTURE_BASE=http://localhost:3000 node company-savebar.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE, OUT } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', ALPHA = 'a0000000-0000-0000-0000-000000000001'
const ACCOUNTS = {
  alpha: { email: 'admin@northcode.ng', shop: ALPHA, entity: 'c7978fca-2e9f-499c-a0ef-e4db9e12d483' },
  soleil: { email: 'ghislainx123@gmail.com', shop: AKWA, entity: '20487333-ae4d-4e00-940b-7319fe009755' },
}
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
const BACKGROUND = w => (w.method === 'PATCH' && w.path === '/rest/v1/profiles') || w.path === '/api/auth/set-role'

async function open({ width, height, account }) {
  const a = ACCOUNTS[account]
  const s = await session({ width, height, scale: 1, locale: 'fr', email: a.email })
  s.entity = (await db.from('entities').select('name, name_confirmed').eq('id', a.entity).single()).data
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } } catch {} }, a.shop)
  s.writes = []; s.errors = []
  s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  await s.page.route(/\/(api|rest\/v1)\//, route => {
    const r = route.request(), url = new URL(r.url())
    if (['GET', 'HEAD'].includes(r.method())) return route.fallback()
    let body = {}; try { body = JSON.parse(r.postData() || '{}') } catch {}
    s.writes.push({ method: r.method(), path: url.pathname, body })
    return route.fulfill({ status: 200, contentType: 'application/json', body: url.pathname.startsWith('/rest/') ? '[]' : '{"success":true}' })
  })
  await s.page.goto(`${BASE}/fr/settings/company`, { waitUntil: 'domcontentloaded' })
  await s.page.getByTestId('company-general').waitFor({ timeout: 45000 })
  await s.page.waitForTimeout(800)
  return s
}
const patches = s => s.writes.filter(w => !BACKGROUND(w) && w.method === 'PATCH' && w.path === '/api/entity')
const inViewport = async (s, loc) => { const b = await loc.boundingBox(); const vh = s.page.viewportSize().height; return b && b.y >= 0 && b.y + b.height <= vh + 1 ? b : null }
const scroll = (s, where) => s.page.evaluate(w => window.scrollTo(0, w === 'top' ? 0 : document.body.scrollHeight), where).then(() => s.page.waitForTimeout(300))

;(async () => {
  console.log('\n1. Ordinateur (1366 × 900) — Alpha, nom non confirmé')
  let s = await open({ width: 1366, height: 900, account: 'alpha' })
  ok(s.entity.name_confirmed === false, `état en base : nom « ${s.entity.name} » non confirmé`)
  ok(await s.page.getByTestId('company-savebar').count() === 0, 'sans modification : aucune barre d’enregistrement')
  ok(await s.page.getByTestId('company-confirm-name').isVisible(), 'bandeau : « Confirmer ce nom »')
  ok(/modifiez-le dans le champ « Nom de l’entreprise » puis enregistrez/.test(await s.page.getByTestId('company-confirm').innerText()), 'bandeau : indique où modifier')
  const name = s.page.locator('#entity-name')
  const newName = `${s.entity.name} TEST`
  await name.fill(newName)
  const bar = s.page.getByTestId('company-savebar')
  await bar.waitFor({ timeout: 5000 })
  await scroll(s, 'top')
  ok(await inViewport(s, bar), 'nom modifié, haut de page : barre visible dans l’écran sans défiler')
  const box = await bar.boundingBox()
  ok(box.x >= 256, `barre à droite du menu latéral (x = ${Math.round(box.x)} ≥ 256)`)
  ok(/Modifications non enregistrées/.test(await bar.innerText()), 'barre : « Modifications non enregistrées »')
  const confirmSave = s.page.getByTestId('company-confirm-save')
  ok((await confirmSave.innerText()).trim() === 'Enregistrer ce nom', 'bandeau : le bouton devient « Enregistrer ce nom »')
  await s.page.screenshot({ path: path.join(OUT, 'company-savebar-desktop.png') })
  await scroll(s, 'bottom')
  ok(await inViewport(s, bar), 'bas de page : barre toujours visible')
  await scroll(s, 'top')
  await confirmSave.click(); await s.page.waitForTimeout(1500)
  let p = patches(s)
  ok(p.length === 1 && JSON.stringify(p[0].body) === JSON.stringify({ name: newName }), `« Enregistrer ce nom » envoie (intercepté) : ${p[0] && JSON.stringify(p[0].body)}`)

  // Après rechargement (données réelles inchangées) : autre champ → libellé générique, puis Annuler
  await s.page.getByTestId('company-general').waitFor()
  await s.page.waitForTimeout(800)
  const city = s.page.locator('#entity-city')
  const cityBefore = await city.inputValue()
  await city.fill('Douala TEST')
  ok((await s.page.getByTestId('company-confirm-save').innerText()).trim() === 'Enregistrer les modifications', 'autre champ modifié : « Enregistrer les modifications »')
  await s.page.getByTestId('company-discard').click(); await s.page.waitForTimeout(300)
  ok(await s.page.getByTestId('company-savebar').count() === 0 && await city.inputValue() === cityBefore, 'Annuler : valeurs d’origine, barre disparue')
  ok(await s.page.getByTestId('company-confirm-name').isVisible(), 'bandeau revenu à « Confirmer ce nom »')
  ok(!s.errors.length, 'aucune erreur')
  await s.browser.close()

  console.log('\n2. Ordinateur — Marché Soleil, nom déjà confirmé')
  s = await open({ width: 1366, height: 900, account: 'soleil' })
  ok(s.entity.name_confirmed === true && await s.page.getByTestId('company-confirm').count() === 0, 'nom confirmé en base : aucun bandeau')
  await s.page.locator('#entity-city').fill('Douala TEST')
  await scroll(s, 'top')
  ok(await inViewport(s, s.page.getByTestId('company-savebar')), 'ville modifiée : barre visible')
  await s.page.getByTestId('company-save').click(); await s.page.waitForTimeout(1500)
  p = patches(s)
  ok(p.length === 1 && JSON.stringify(p[0].body) === '{"city":"Douala TEST"}', `Enregistrer : seul le champ modifié est envoyé (intercepté) : ${p[0] && JSON.stringify(p[0].body)}`)
  ok(!s.errors.length, 'aucune erreur')
  await s.browser.close()

  console.log('\n3. Téléphone (390 × 844) — Marché Soleil')
  s = await open({ width: 390, height: 844, account: 'soleil' })
  ok(await s.page.getByTestId('company-savebar').count() === 0, 'sans modification : aucune barre')
  await s.page.locator('#entity-name').fill('Marché Soleil SARL')
  const mbar = s.page.getByTestId('company-savebar')
  await mbar.waitFor({ timeout: 5000 })
  await scroll(s, 'top')
  const bb = await inViewport(s, mbar)
  const nav = await s.page.locator('nav.fixed.bottom-0').boundingBox()
  ok(bb && nav && bb.y + bb.height <= nav.y + 1, `barre visible AU-DESSUS de la navigation (bas ${bb && Math.round(bb.y + bb.height)} ≤ ${nav && Math.round(nav.y)})`)
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(overflow <= 0, `aucun défilement horizontal (${overflow} px)`)
  await s.page.screenshot({ path: path.join(OUT, 'company-savebar-mobile.png') })
  await s.page.getByTestId('company-save').click(); await s.page.waitForTimeout(1500)
  p = patches(s)
  ok(p.length === 1 && JSON.stringify(p[0].body) === '{"name":"Marché Soleil SARL"}', `Enregistrer (barre) : envoi intercepté : ${p[0] && JSON.stringify(p[0].body)}`)
  ok(!s.errors.length, 'aucune erreur')
  await s.browser.close()

  const after = (await db.from('entities').select('name, city, name_confirmed').in('id', [ACCOUNTS.alpha.entity, ACCOUNTS.soleil.entity])).data
  ok(after.every(e => !/TEST|SARL/.test(`${e.name} ${e.city}`)), 'base inchangée : aucun nom ni ville de test enregistré')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
