// Paramètres › Entreprise — devise de consolidation (lot 5, D1, migration 177).
// A. Navigateur, LECTURE SEULE : toute écriture est interceptée (corps relu, jamais envoyée).
// B. Requêtes directes au serveur LOCAL : refus (403 / 400) sans écriture ; une seule écriture réelle, sur Alpha :
//    ré-enregistrement de la MÊME valeur (NGN) → succès, valeur inchangée, aucune entrée de journal.
// Usage : CAPTURE_BASE=http://localhost:3000 node company-consolidation.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE, LOCAL, OUT } = require('./lib/capture.js')
if (!LOCAL) { console.error('Serveur local uniquement (partie B écrit sur Alpha)'); process.exit(1) }
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const ALPHA = 'a0000000-0000-0000-0000-000000000001', AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const ALPHA_ENTITY = 'c7978fca-2e9f-499c-a0ef-e4db9e12d483', SOLEIL_ENTITY = '20487333-ae4d-4e00-940b-7319fe009755'
const SOLEIL_OWNER = 'ghislainx123@gmail.com', ALPHA_OWNER = 'admin@northcode.ng'
const JEANPAUL = 'ghislainx123+jeanpaul@gmail.com', FATOU = 'ghislainx123+fatou@gmail.com'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })
const BACKGROUND = w => (w.method === 'PATCH' && w.path === '/rest/v1/profiles') || w.path === '/api/auth/set-role'

async function open(email, shop, { width = 1366, height = 900 } = {}) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  await s.page.addInitScript(id => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id); localStorage.setItem('active_shop_id', id) } } catch {} }, shop)
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
  await s.page.getByTestId('company-consolidation').waitFor({ timeout: 45000 })
  await s.page.waitForTimeout(800)
  return s
}
const shot = (s, name) => s.page.screenshot({ path: path.join(OUT, name), fullPage: false })

async function login(email) {
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  return async (method, url, body) => {
    const r = await fetch(BASE + url, { method, headers: { cookie, 'content-type': 'application/json', 'accept-language': 'fr' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    let json = {}; try { json = await r.json() } catch {}
    return { status: r.status, json }
  }
}
const currencyOf = async id => (await db.from('entities').select('consolidation_currency, updated_at').eq('id', id).single()).data

;(async () => {
  const before = { alpha: await currencyOf(ALPHA_ENTITY), soleil: await currencyOf(SOLEIL_ENTITY) }
  const { count: auditBefore } = await db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('target_id', ALPHA_ENTITY)

  console.log('\nA1. Marché Soleil (propriétaire) : une seule devise')
  let s = await open(SOLEIL_OWNER, AKWA)
  let sel = s.page.getByTestId('company-consolidation-select')
  ok(/XAF/.test(await sel.innerText()), `valeur affichée : ${(await sel.innerText()).trim()}`)
  ok(/Utilisée pour consolider les rapports lorsque vos boutiques utilisent plusieurs devises/.test(await s.page.getByTestId('company-consolidation').innerText()), 'texte d’aide demandé')
  ok(/même devise \(XAF\).*aucune conversion/.test(await s.page.getByTestId('company-shop-currencies').innerText()), 'message « même devise (XAF) : aucune conversion »')
  ok(await sel.isEnabled(), 'propriétaire : modifiable')
  await s.page.getByTestId('company-consolidation').scrollIntoViewIfNeeded(); await shot(s, 'company-consolidation-soleil.png')
  ok(!s.errors.length && !s.writes.filter(w => !BACKGROUND(w)).length, 'aucune erreur, aucune écriture')
  await s.browser.close()

  console.log('\nA2. Groupe Boutique Alpha (propriétaire) : NGN + XAF')
  s = await open(ALPHA_OWNER, ALPHA)
  sel = s.page.getByTestId('company-consolidation-select')
  ok(/NGN/.test(await sel.innerText()), `valeur affichée : ${(await sel.innerText()).trim()}`)
  ok(/Devises de vos boutiques : NGN, XAF/.test(await s.page.getByTestId('company-shop-currencies').innerText()), 'devises des boutiques : NGN, XAF')
  await s.page.getByTestId('company-consolidation').scrollIntoViewIfNeeded()
  await sel.click(); await s.page.waitForTimeout(400)
  const opts = await s.page.getByRole('option').allInnerTexts()
  ok(opts.length === 20 && new Set(opts.slice(0, 2).map(o => o.slice(0, 3))).size === 2 && opts.slice(0, 2).every(o => /^(NGN|XAF)/.test(o)), `20 devises, celles des boutiques en tête : ${opts.slice(0, 3).join(' | ')}…`)
  await shot(s, 'company-consolidation-alpha-liste.png')
  await s.page.getByRole('option', { name: /^XAF/ }).click(); await s.page.waitForTimeout(300)
  const save = s.page.getByTestId('company-save')
  ok(await save.isEnabled(), 'changement → bouton Enregistrer actif')
  await save.click(); await s.page.waitForTimeout(1200)
  const patch = s.writes.find(w => w.method === 'PATCH' && w.path === '/api/entity')
  // Nom d'entreprise pas encore confirmé : la page renvoie le nom INCHANGÉ pour le confirmer (comportement de la refonte Entreprise)
  const { data: alphaEnt } = await db.from('entities').select('name, name_confirmed').eq('id', ALPHA_ENTITY).single()
  const expected = alphaEnt.name_confirmed ? { consolidation_currency: 'XAF' } : { consolidation_currency: 'XAF', name: alphaEnt.name }
  ok(patch && JSON.stringify(patch.body) === JSON.stringify(expected), `envoyé (intercepté, jamais transmis) : ${patch && JSON.stringify(patch.body)}`)
  ok(!s.errors.length, 'aucune erreur')
  await s.browser.close()

  console.log('\nA3. Jean-Paul (gérant d’Akwa) : lecture seule')
  s = await open(JEANPAUL, AKWA)
  sel = s.page.getByTestId('company-consolidation-select')
  ok(/XAF/.test(await sel.innerText()) && await sel.isDisabled(), 'devise visible, liste désactivée')
  await s.browser.close()

  console.log('\nA4. Téléphone (390 px)')
  s = await open(SOLEIL_OWNER, AKWA, { width: 390, height: 844 })
  await s.page.getByTestId('company-consolidation').scrollIntoViewIfNeeded()
  const overflow = await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ok(overflow <= 0, `aucun défilement horizontal (${overflow} px)`)
  await shot(s, 'company-consolidation-mobile.png')
  await s.browser.close()

  console.log('\nB. Serveur local : contrôles côté serveur')
  const fatou = await login(FATOU), jp = await login(JEANPAUL), soleil = await login(SOLEIL_OWNER), alpha = await login(ALPHA_OWNER)
  ok((await fatou('GET', `/api/entity?shop_id=${AKWA}`)).status === 403, 'caissière : lecture refusée (403)')
  ok((await jp('PATCH', `/api/entity?shop_id=${AKWA}`, { consolidation_currency: 'NGN' })).status === 403, 'gérant : modification refusée (403)')
  for (const bad of ['ABC', 'xaf', 123, null, '']) {
    const r = await soleil('PATCH', `/api/entity?shop_id=${AKWA}`, { consolidation_currency: bad })
    ok(r.status === 400 && r.json.field === 'consolidation_currency', `valeur ${JSON.stringify(bad)} refusée (400)`)
  }
  const g = await alpha('GET', `/api/entity?shop_id=${ALPHA}`)
  ok(g.status === 200 && g.json.entity.consolidation_currency === 'NGN' && g.json.entity.shop_currencies.join() === 'NGN,XAF', 'GET : NGN, devises NGN + XAF')
  const same = await alpha('PATCH', `/api/entity?shop_id=${ALPHA}`, { consolidation_currency: 'NGN' })
  ok(same.status === 200, 'Alpha : ré-enregistrement de la même valeur accepté')

  const after = { alpha: await currencyOf(ALPHA_ENTITY), soleil: await currencyOf(SOLEIL_ENTITY) }
  const { count: auditAfter } = await db.from('audit_logs').select('id', { count: 'exact', head: true }).eq('target_id', ALPHA_ENTITY)
  ok(after.alpha.consolidation_currency === 'NGN' && after.soleil.consolidation_currency === 'XAF', 'base : Alpha NGN, Marché Soleil XAF (inchangés)')
  ok(after.soleil.updated_at === before.soleil.updated_at, 'Marché Soleil : aucune écriture (updated_at identique)')
  ok(auditAfter === auditBefore, 'aucune entrée de journal (valeur inchangée)')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
