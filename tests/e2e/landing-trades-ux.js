// Pages Métiers et Santé, liste d'attente (lot C du 6 nov. 2026, migration 217). LECTURE SEULE par défaut :
//   1-4. Navigateur (visiteur) : /api/waitlist SIMULÉ (aucune inscription réelle). Cartes, « Me prévenir » qui choisit le
//        métier, contrôles du formulaire, hors connexion (saisie gardée, « Réessayer »), succès, page Santé (pastilles,
//        illustrations annoncées, aucune promesse d'assurance, métier fixé + établissement), téléphone, haoussa.
//   5. Serveur réel, sans écriture : refus des envois invalides, piège à robots (réponse normale, rien d'enregistré),
//      table toujours fermée au navigateur (clé publique).
//   6. Admin → Liste d'attente (lecture).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/landing-trades-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anonDb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

// Visiteur ; /api/waitlist simulé (réponse choisie), toute autre écriture interceptée
async function visit({ locale = 'fr', path = '/metiers', width = 1440, height = 900, waitlist = { status: 200, body: { ok: true } } }) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const mobile = width < 500
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile, locale: locale === 'fr' ? 'fr-FR' : 'en-US', serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = [], posted = []
  await page.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url())
    if (u.pathname === '/api/waitlist') { posted.push(JSON.parse(r.postData() || 'null')); return route.fulfill({ status: waitlist.status, contentType: 'application/json', body: JSON.stringify(waitlist.body) }) }
    if (u.pathname === '/api/geo') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"country":null}' })
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    sent.push(`${r.method()} ${u.pathname}`)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  const res = await page.goto(`${BASE}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 120000 }); await wait(1200)
  return { browser, ctx, page, errors, sent, posted, status: res && res.status() }
}
const msg = async p => norm(await p.getByTestId('waitlist-message').first().innerText().catch(() => ''))
const deadLinks = async v => {
  const hrefs = Array.from(new Set(await v.page.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href').split('#')[0]))))
  const dead = []
  for (const h of hrefs) { const r = await v.ctx.request.get(BASE + h, { maxRedirects: 0 }).catch(() => null); if (!r || r.status() >= 400) dead.push(`${h} ${r && r.status()}`) }
  return { dead, n: hrefs.length }
}

;(async () => {
  console.log('1. Page Métiers (ordinateur)')
  let v = await visit({}); let p = v.page
  ok(v.status === 200, 'page servie (200)', v.status)
  ok(norm(await p.locator('h1').innerText()) === 'Le commerce aujourd\'hui. Vos autres activités ensuite.', 'titre')
  ok(await p.getByTestId('site-nav-trades').getAttribute('aria-current') === 'page', 'en-tête : « Métiers » page en cours')
  const tags = {}
  for (const k of ['commerce', 'health', 'services', 'education', 'rental']) tags[k] = norm(await p.getByTestId(`trade-${k}`).locator('.tag').innerText())
  ok(tags.commerce === 'Disponible' && tags.health === 'Prochainement' && tags.services === 'Bientôt' && tags.education === 'Bientôt' && tags.rental === 'Bientôt', 'états : Commerce disponible, Santé prochainement, autres bientôt', tags)
  const { dead, n } = await deadLinks(v)
  ok(dead.length === 0, `aucun lien mort (${n} liens internes)`, dead)
  // « Me prévenir » d'une carte : choisit le métier et mène au formulaire
  await p.getByTestId('notify-education').click(); await wait(900)
  ok(await p.getByTestId('waitlist-sector').inputValue() === 'education', '« Me prévenir » (Éducation) : métier choisi dans le formulaire')
  const inView = await p.locator('#liste').evaluate(e => { const r = e.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0 })
  ok(inView, 'le formulaire est à l\'écran')
  // Contrôles
  await p.getByTestId('waitlist-contact').fill('pas-un-contact'); await p.getByTestId('waitlist-submit').click(); await wait(300)
  ok(/adresse e-mail ou un numéro de téléphone valide/.test(await msg(p)) && v.posted.length === 0, 'contact invalide : message, rien envoyé', await msg(p))
  await p.getByTestId('waitlist-sector').selectOption(''); await p.getByTestId('waitlist-contact').fill('ami@exemple.cm'); await p.getByTestId('waitlist-submit').click(); await wait(300)
  ok(/Choisissez votre activité/.test(await msg(p)) && v.posted.length === 0, 'sans activité : message, rien envoyé')
  // Santé : l'établissement apparaît
  await p.getByTestId('waitlist-sector').selectOption('health'); await wait(200)
  ok(await p.getByTestId('waitlist-sub').count() === 1, 'Santé : choix de l\'établissement proposé')
  await p.getByTestId('waitlist-sub').selectOption('pharmacy')
  ok(await p.locator('input[name="website"]').evaluate(e => e.tabIndex === -1 && e.getAttribute('aria-hidden') === 'true' && e.getBoundingClientRect().left < 0), 'champ piège invisible et hors du parcours clavier')
  // Hors connexion : saisie gardée, « Réessayer »
  await v.ctx.setOffline(true)
  await p.getByTestId('waitlist-submit').click(); await wait(500)
  ok(/Pas de connexion/.test(await msg(p)) && await p.getByTestId('waitlist-contact').inputValue() === 'ami@exemple.cm' && /Réessayer/.test(await p.getByTestId('waitlist-submit').innerText()), 'hors connexion : message clair, saisie gardée, « Réessayer »', await msg(p))
  await v.ctx.setOffline(false); await wait(300)
  await p.getByTestId('waitlist-submit').click(); await wait(800)
  const done = norm(await p.getByTestId('waitlist-done').innerText().catch(() => ''))
  ok(/C'est noté/.test(done) && /Santé/.test(done), 'réseau revenu : inscription confirmée', done)
  const b = v.posted[v.posted.length - 1] || {}
  ok(b.sector === 'health' && b.sub_trade === 'pharmacy' && b.contact === 'ami@exemple.cm' && b.locale === 'fr' && b.website === '', 'envoi : métier, établissement, contact, langue ; piège vide', b)
  await p.screenshot({ path: OUT + '/site-trades-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun autre envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()
  // Refus du serveur : messages
  v = await visit({ waitlist: { status: 429, body: { ok: false, error: 'rate_limited' } } }); p = v.page
  await p.getByTestId('waitlist-sector').selectOption('rental'); await p.getByTestId('waitlist-contact').fill('+237 699 00 11 22'); await p.getByTestId('waitlist-submit').click(); await wait(600)
  ok(/Trop d'essais/.test(await msg(p)), 'trop d\'essais : message clair')
  await v.browser.close()

  console.log('\n2. Page Santé (ordinateur)')
  v = await visit({ path: '/metiers/sante' }); p = v.page
  ok(v.status === 200 && norm(await p.locator('h1').innerText()) === 'Gérez votre clinique, votre pharmacie ou votre laboratoire.', 'page servie, titre')
  const pills = await p.locator('[data-testid="platform-nav"] a').allInnerTexts()
  ok(pills.join('|') === 'Clinique|Pharmacie|Laboratoire|Cabinets et centres de soins|Le socle commun', 'pastilles des sous-métiers', pills)
  const main = norm(await p.locator('main').innerText())
  ok(!/assuran/i.test(main), 'aucune promesse d\'assurance (retirée jusqu\'à la V1 du module)')
  ok(!/bilan du matin/i.test(main), 'pas de « bilan du matin »')
  ok((main.match(/Illustration : le module Santé est en préparation\./g) || []).length === 3, 'trois illustrations, chacune annoncée comme telle')
  ok(await p.getByTestId('waitlist-sector').count() === 0 && await p.getByTestId('waitlist-sub').count() === 1, 'formulaire : métier fixé (Santé), établissement au choix')
  await p.getByTestId('health-notify').click(); await wait(900)
  await p.getByTestId('waitlist-sub').selectOption('laboratory'); await p.getByTestId('waitlist-contact').fill('Labo@Exemple.CM'); await p.getByTestId('waitlist-submit').click(); await wait(800)
  const hb = v.posted[v.posted.length - 1] || {}
  ok(hb.sector === 'health' && hb.sub_trade === 'laboratory' && /C'est noté/.test(norm(await p.getByTestId('waitlist-done').innerText().catch(() => ''))), 'inscription Santé / laboratoire', hb)
  const d2 = await deadLinks(v)
  ok(d2.dead.length === 0, `aucun lien mort (${d2.n} liens internes)`, d2.dead)
  await p.evaluate(() => window.scrollTo(0, 0)); await wait(300)
  await p.screenshot({ path: OUT + '/site-health-pc.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, aucun autre envoi', { errors: v.errors, sent: v.sent })
  await v.browser.close()

  console.log('\n3. Téléphone')
  const wide = []
  for (const width of [320, 390]) for (const locale of ['fr', 'en', 'ha']) for (const path of ['/metiers', '/metiers/sante']) {
    v = await visit({ locale, width, height: 760, path })
    const w = await v.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    if (w[0] > w[1]) wide.push(`${locale}${path} ${width} : ${w[0]}`)
    if (v.errors.length) wide.push(`${locale}${path} ${width} : erreur JS ${v.errors[0]}`)
    await v.browser.close()
  }
  ok(wide.length === 0, 'rien ne dépasse (320 et 390 px, fr / en / ha, Métiers et Santé)', wide)
  v = await visit({ width: 390, height: 844, path: '/metiers/sante' }); p = v.page
  await p.locator('#liste').scrollIntoViewIfNeeded(); await wait(400)
  const bh = await p.getByTestId('waitlist-submit').evaluate(e => e.getBoundingClientRect().height)
  ok(bh >= 44, `téléphone : bouton « Me prévenir » de ${bh} px`)
  await p.screenshot({ path: OUT + '/site-health-phone.png' })
  await v.browser.close()

  console.log('\n4. Haoussa')
  v = await visit({ locale: 'ha', path: '/metiers/sante' })
  ok(norm(await v.page.locator('h1').innerText()) === 'Gudanar da asibitinku, kantin maganinku ko ɗakin gwaje-gwajenku.', 'haoussa : titre de la page Santé')
  await v.browser.close()

  console.log('\n5. Serveur réel, sans écriture')
  const count = async () => { const { count: c } = await db.from('waitlist').select('id', { count: 'exact', head: true }); return c }
  const before = await count()
  const post = body => fetch(`${BASE}/api/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }).then(async r => [r.status, await r.json().catch(() => null)])
  const cases = [
    ['corps illisible', '{pas du json', 400, 'invalid_body'],
    ['métier inconnu', { sector: 'casino', contact: 'a@exemple.cm', locale: 'fr' }, 400, 'invalid_sector'],
    ['établissement d\'un autre métier', { sector: 'services', sub_trade: 'pharmacy', contact: 'a@exemple.cm', locale: 'fr' }, 400, 'invalid_sub_trade'],
    ['contact invalide', { sector: 'health', contact: 'abc', locale: 'fr' }, 400, 'invalid_contact'],
  ]
  for (const [name, body, st, code] of cases) { const [s, j] = await post(body); ok(s === st && j && j.error === code, `${name} : refusé (${st} ${code})`, [s, j]) }
  const [ts, tj] = await post({ sector: 'health', contact: 'robot@exemple.cm', locale: 'fr', website: 'https://spam.example' })
  ok(ts === 200 && tj && tj.ok === true, 'piège rempli : réponse normale (rien n\'est dit au robot)', [ts, tj])
  ok(await count() === before, `aucune ligne écrite par ces envois (${before} avant et après)`)
  const { data: anonRows, error: anonErr } = await anonDb.from('waitlist').select('id').limit(1)
  ok(!!anonErr || (anonRows || []).length === 0, 'clé publique du navigateur : liste illisible', anonErr && anonErr.message)
  const { error: anonIns } = await anonDb.from('waitlist').insert({ sector: 'health', contact: 'direct@exemple.cm', contact_kind: 'email' })
  ok(!!anonIns, 'clé publique : inscription directe refusée (passage obligé par le serveur)', anonIns && anonIns.message)

  console.log('\n6. Admin → Liste d\'attente (lecture)')
  const s = await session({ width: 1366, height: 900, email: 'admin@northcode.ng' })
  await s.page.goto(`${BASE}/fr/admin/waitlist`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  const adminText = norm(await s.page.getByTestId('admin-waitlist').innerText().catch(() => ''))
  ok(/Liste d'attente/.test(adminText) && new RegExp(`Tous · ${before}`).test(adminText), `page admin : titre et total (${before})`, adminText.slice(0, 200))
  await s.page.screenshot({ path: OUT + '/site-waitlist-admin.png' })
  await s.browser.close()

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
