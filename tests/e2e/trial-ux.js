// Protection de l'essai gratuit (tarification étape 4A-2a, migration 213). LECTURE SEULE, serveur local ; TOUTE
// écriture est interceptée (aucun compte créé, aucun numéro enregistré).
//   1. Inscription (sans session) : numéro obligatoire et contrôlé, envoyé au format international avec l'identifiant
//      d'appareil ; numéro déjà utilisé → compte sans essai, dit sur l'écran de confirmation (réponse simulée).
//   2. Compte Google en attente du téléphone : écran « Votre numéro » (état SIMULÉ sur Marché Soleil en remplaçant la
//      lecture de l'entreprise), envoi intercepté.
//   3. Essai refusé : le mur de paiement l'explique (état simulé).
//   4. Admin → Activation : « Essais à vérifier » (liste simulée), essai accordé à la main (intercepté), lecture réelle.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/trial-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const { chromium } = require('playwright-core')
const OUT = __dirname + '/out'
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').replace(/[  ]/g, ' ').trim()
process.on('unhandledRejection', e => { if (/has been closed/.test(String(e && e.message))) return; console.error('ERREUR', e); process.exit(1) })

// Session connectée, lecture de l'entreprise REMPLACÉE par un état d'essai simulé (compte vu comme non interne) ;
// toute écriture interceptée
async function openWithTrial({ email = 'ghislainx123@gmail.com', trial, mocks = {}, path = '/dashboard', width = 1366, height = 900 }) {
  const s = await session({ width, height, scale: 1, locale: 'fr', email })
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  const sent = [], posts = [], real = []
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request(), u = new URL(r.url()), w = `${r.method()} ${u.pathname}`
    if (mocks[w] !== undefined) {
      if (r.method() !== 'GET') posts.push({ w, body: JSON.parse(r.postData() || '{}') })
      if (mocks[w] === 'real') { const res = await route.fetch(); real.push({ w, status: res.status(), body: await res.json().catch(() => null) }); return route.fulfill({ response: res }) }
      const v = typeof mocks[w] === 'function' ? mocks[w](u) : mocks[w]
      return route.fulfill({ status: v.status || 200, contentType: 'application/json', body: JSON.stringify(v.body ?? v) })
    }
    if (trial && r.method() === 'GET' && u.pathname === '/rest/v1/entities' && /plan_expires_at/.test(u.searchParams.get('select') || '')) {
      // Lecture réelle sans la colonne d'état (absente avant la 213), puis état d'essai simulé
      const sel = (u.searchParams.get('select') || '').replace(/,\s*trial_status/, '')
      u.searchParams.set('select', sel)
      const res = await route.fetch({ url: u.toString() })
      let rows = await res.json().catch(() => null)
      if (Array.isArray(rows)) rows = rows.map(e => ({ ...e, plan: 'trial', plan_expires_at: null, next_plan: null, next_plan_from: null, next_plan_until: null, ...trial }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    }
    // Marché Soleil est un compte vitrine INTERNE (accès toujours ouvert, voulu) : vu comme un compte normal pour le test
    if (trial && r.method() === 'GET' && u.pathname.startsWith('/rest/v1/')) {
      const res = await route.fetch()
      const body = (await res.text()).replace(/"is_internal":\s*true/g, '"is_internal":false')
      return route.fulfill({ status: res.status(), headers: res.headers(), body })
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
    if (['POST /api/reports/margin', 'POST /api/team/status'].includes(w)) return route.fallback()
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await s.page.goto(`${BASE}/fr${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
  return { ...s, errors, sent, posts, real }
}

;(async () => {
  console.log('1. Inscription : numéro obligatoire et contrôlé (sans session, tout intercepté)')
  {
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'fr-FR', serviceWorkers: 'block' })
    const page = await ctx.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
    const posts = [], other = []
    let reply = { status: 200, body: { success: true, shop_id: 'x', trial: 'refused' } }
    await page.route('**/*', async route => {
      const r = route.request()
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return route.fallback()
      const u = new URL(r.url())
      if (u.pathname === '/api/register') { posts.push(JSON.parse(r.postData() || '{}')); return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) }) }
      other.push(`${r.method()} ${u.host}${u.pathname}`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto(`${BASE}/fr/register`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(5000)
    await page.locator('input[name="full_name"]').fill('Amadou Test')
    await page.locator('input[name="email"]').fill('amadou.test@example.com')
    await page.locator('input[name="password"]').fill('MotDePasse123')
    await page.locator('input[name="confirm_password"]').fill('MotDePasse123')
    await page.getByRole('button', { name: 'Suivant' }).first().click(); await wait(1200)
    await page.getByText('Cameroun', { exact: true }).first().click(); await wait(500)
    await page.getByRole('button', { name: 'Suivant' }).last().click(); await wait(1500)
    await page.locator('input[name="shop_name"]').fill('Boutique Test')
    await page.locator('input[name="city"]').fill('Douala')
    ok(norm(await page.locator('form').innerText()).includes('Un seul essai gratuit par numéro.'), 'règle dite sous le champ : un seul essai par numéro')
    ok(!norm(await page.locator('form').innerText()).includes('Téléphone (optionnel)'), 'téléphone plus « optionnel »')
    const submit = page.locator('button[type="submit"]')
    await submit.click(); await wait(1200)
    ok(norm(await page.getByTestId('register-phone-error').innerText()) === 'Le numéro de téléphone est obligatoire.' && posts.length === 0, 'sans numéro : refus à l\'écran, rien envoyé')
    await page.locator('#register-phone').fill('12345'); await page.locator('#register-phone').blur(); await wait(300)
    await submit.click(); await wait(1200)
    ok(norm(await page.getByTestId('register-phone-error').innerText()) === 'Numéro de téléphone invalide pour ce pays.' && posts.length === 0, 'numéro invalide : refus à l\'écran, rien envoyé')
    await page.locator('#register-phone').fill('690 12 34 56'); await page.locator('#register-phone').blur(); await wait(300)
    await page.screenshot({ path: OUT + '/trial-register.png' })
    await submit.click(); await wait(4000)
    const p = posts[0] || {}
    ok(p.phone === '+237690123456', `envoyé au format international (${p.phone})`)
    ok(/^[0-9a-f]{32}$/.test(p.device_id || ''), 'identifiant d\'appareil envoyé (jeton aléatoire)')
    const kept = await page.evaluate(() => localStorage.getItem('ss_device_id'))
    ok(kept === p.device_id, 'identifiant d\'appareil gardé malgré le nettoyage du stockage')
    ok(norm(await page.getByTestId('register-trial-refused').innerText()).startsWith('Ce numéro a déjà bénéficié d\'un essai gratuit.'), 'numéro déjà utilisé : dit sur l\'écran de confirmation')
    await page.screenshot({ path: OUT + '/trial-register-refused.png' })
    ok(!other.some(x => /\/rest\/v1\//.test(x)) && errors.length === 0, `aucune écriture en base, aucune erreur JS (${[...other.filter(x => /rest/.test(x)), ...errors].join(', ') || 'aucune'})`)
    await browser.close()
  }

  console.log('\n2. Compte Google : écran du numéro avant l\'essai (état simulé)')
  {
    const s = await openWithTrial({ trial: { trial_ends_at: null, trial_status: 'pending_phone' }, mocks: { 'POST /api/trial/phone': { ok: true, trial: 'granted' } } })
    const page = s.page
    const gate = page.getByTestId('trial-phone-gate')
    ok(await gate.isVisible(), 'écran « Votre numéro de téléphone » affiché')
    ok(norm(await gate.innerText()).includes('Une dernière étape pour démarrer votre essai gratuit de 30 jours.'), 'raison dite : démarrer l\'essai')
    ok(await page.getByText('Votre essai gratuit est terminé').count() === 0, 'pas de mur « essai terminé » à la place')
    await page.getByTestId('trial-phone-submit').click(); await wait(800)
    ok(norm(await page.getByTestId('trial-phone-error').innerText()) === 'Le numéro de téléphone est obligatoire.' && !s.posts.length, 'sans numéro : refus, rien envoyé')
    await page.locator('#trial-phone').fill('677 12 34 56'); await page.locator('#trial-phone').blur(); await wait(300)
    await page.screenshot({ path: OUT + '/trial-gate.png' })
    await page.getByTestId('trial-phone-submit').click(); await wait(2500)
    const b = s.posts[0]?.body || {}
    ok(b.shop_id === '7313d74e-43dd-4b36-a59e-17ba370d29a1' && b.phone === '+237677123456' && /^[0-9a-f]{32}$/.test(b.device_id || ''), 'envoyé : boutique, numéro international, appareil', b)
    ok(s.sent.length === 0 && s.errors.length === 0, `aucune autre écriture ni erreur JS (${[...s.sent, ...s.errors].join(', ') || 'aucune'})`)
    await s.browser.close()
  }
  {
    const s = await openWithTrial({ trial: { trial_ends_at: null, trial_status: 'pending_phone' }, width: 390, height: 844 })
    const box = await s.page.getByTestId('trial-phone-submit').boundingBox()
    ok(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, `téléphone : bouton entier et touchable (${box && Math.round(box.height)} px)`)
    await s.page.screenshot({ path: OUT + '/trial-gate-phone.png' })
    await s.browser.close()
  }

  console.log('\n3. Essai refusé : le mur de paiement l\'explique (état simulé)')
  {
    const s = await openWithTrial({ trial: { trial_ends_at: new Date(Date.now() - 86400000).toISOString(), trial_status: 'refused' } })
    const t = s.page.getByTestId('upgrade-wall-trial-refused')
    ok(await t.isVisible() && norm(await t.innerText()) === 'Ce numéro a déjà eu son essai gratuit', 'titre : « Ce numéro a déjà eu son essai gratuit »')
    ok(norm(await s.page.locator('body').innerText()).includes('Votre compte est prêt : choisissez une formule pour commencer.'), 'suite dite : choisir une formule, contact en cas d\'erreur')
    ok(await s.page.getByTestId('trial-phone-gate').count() === 0, 'pas d\'écran du numéro (déjà donné)')
    await s.page.screenshot({ path: OUT + '/trial-refused-wall.png' })
    ok(s.sent.length === 0 && s.errors.length === 0, 'aucune écriture ni erreur JS')
    await s.browser.close()
  }

  console.log('\n4. Admin → Activation : essais à vérifier')
  {
    const iso = d => new Date(Date.now() + d * 86400000).toISOString()
    const ROWS = [
      { id: 'c1', entity_id: '00000000-0000-0000-0000-0000000000a1', entity_name: 'Boutique Test 1', owner_name: 'Amadou Test', source: 'register', granted: false, flags: ['phone_reused'], created_at: iso(-1), trial_status: 'refused', deleted: false, admin_grant: null },
      { id: 'c2', entity_id: '00000000-0000-0000-0000-0000000000a2', entity_name: 'Boutique Test 2', owner_name: 'Awa Test', source: 'oauth', granted: true, flags: ['same_device', 'same_name_city'], created_at: iso(-3), trial_status: 'granted', deleted: false, admin_grant: null },
    ]
    const s = await openWithTrial({ email: 'admin@northcode.ng', path: '/admin/activation', mocks: {
      'GET /api/admin/trial-review': { rows: ROWS }, 'POST /api/admin/trial-review': { ok: true },
    } })
    const page = s.page
    const panel = page.getByTestId('trial-review-panel')
    ok(await panel.isVisible(), 'panneau « Essais à vérifier » affiché')
    const txt = norm(await panel.innerText())
    ok(txt.includes('Numéro déjà utilisé') && txt.includes('Même appareil') && txt.includes('Même nom et même ville'), 'raisons en clair')
    ok(txt.includes('Essai refusé') && txt.includes('Essai accordé') && !/\+?\d{9,}/.test(txt), 'état de l\'essai, aucun numéro affiché')
    ok(await page.getByTestId('trial-grant-open').count() === 1, '« Accorder l\'essai » seulement pour l\'essai refusé')
    await page.getByTestId('trial-grant-open').click(); await wait(400)
    ok(await page.getByTestId('trial-grant-confirm').isDisabled(), 'motif vide : impossible')
    await page.getByTestId('trial-grant-reason').fill('Numéro partagé en famille')
    await panel.screenshot({ path: OUT + '/trial-admin.png' })
    await page.getByTestId('trial-grant-confirm').click(); await wait(1500)
    ok(JSON.stringify(s.posts[0]?.body) === JSON.stringify({ entity_id: '00000000-0000-0000-0000-0000000000a1', reason: 'Numéro partagé en famille' }), 'envoyé : entreprise + motif', s.posts[0])
    ok(s.sent.length === 0 && s.errors.length === 0, `aucune autre écriture ni erreur JS (${[...s.sent, ...s.errors].join(', ') || 'aucune'})`)
    await s.browser.close()
  }
  {
    const s = await openWithTrial({ email: 'admin@northcode.ng', path: '/admin/activation', mocks: { 'GET /api/admin/trial-review': 'real' } })
    const r = s.real[s.real.length - 1]
    ok(r && r.status === 200 && Array.isArray(r.body && r.body.rows), `lecture réelle : ${r && r.status}, ${r && r.body && r.body.rows && r.body.rows.length} ligne(s)${r && r.body && r.body.unavailable ? ' (registre pas encore créé)' : ''}`)
    await s.browser.close()
    const o = await session({ width: 1366, height: 900, scale: 1, locale: 'fr', email: 'ghislainx123@gmail.com' })
    const res = await o.page.request.get(`${BASE}/api/admin/trial-review`)
    ok([401, 403].includes(res.status()), `propriétaire de boutique : liste refusée (${res.status()})`)
    await o.browser.close()
  }

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})()
