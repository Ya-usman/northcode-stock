// Contexte boutique au démarrage — règle déterministe, mémorisée PAR UTILISATEUR. LECTURE SEULE (aucune
// écriture en base : seuls le stockage local du navigateur de test et les cookies de session changent).
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { chromium } = require('playwright-core')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = 'http://localhost:3000'
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BONA = 'e665d4a0-da40-4436-a3b2-1b377760a47b', ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

// Session d'un compte dans un contexte de navigateur existant (changement de compte sur le même appareil)
async function loginAs(ctx, email) {
  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const { data } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  await ctx.clearCookies()
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  await ctx.addCookies([...parts.map((p, i) => ({ name: `sb-${REF}-auth-token.${i}`, value: p, domain: 'localhost', path: '/' })), { name: 'NEXT_LOCALE', value: 'fr', domain: 'localhost', path: '/' }])
  return data.user.id
}
async function header(page) {
  const h = page.getByTestId('header-shop-context')
  await h.waitFor({ timeout: 60000 })
  for (let i = 0; i < 20; i++) { const t = (await h.innerText()).trim(); if (t) return t; await page.waitForTimeout(500) }
  return ''
}
const ls = (page, k) => page.evaluate(k => localStorage.getItem(k), k)
// Même filet que lib/capture.js : horaires d'ouverture neutralisés (dans ce navigateur seulement) et TOUTE écriture bloquée
async function guard(ctx) {
  await ctx.route('**/*', async route => {
    const r = route.request(), url = r.url(), method = r.method()
    if (method === 'GET' && /\/rest\/v1\/(shops|shop_members)\?/.test(url)) {
      const res = await route.fetch()
      return route.fulfill({ response: res, body: (await res.text()).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false') })
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/\/auth\/v1\/token/.test(url)) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
  return ctx
}
const go = async (page, path = '/fr/stock/products') => { await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForTimeout(5000) }

;(async () => {
  const users = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users
  const ms = users.find(u => u.email === 'ghislainx123@gmail.com'), adm = users.find(u => u.email === 'admin@northcode.ng'), cash = users.find(u => u.email === 'stocshopci@gmail.com')
  const msProfile = (await db.from('profiles').select('shop_id').eq('id', ms.id).single()).data
  const browser = await chromium.launch({ channel: 'msedge', headless: true })

  console.log('Appareil neuf, compte à plusieurs boutiques (Marché Soleil)')
  let ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }); await guard(ctx)
  await ctx.addInitScript(() => { try { localStorage.setItem('auth_remember_me', '1') } catch {} })
  let page = await ctx.newPage()
  await loginAs(ctx, ms.email); await go(page)
  ok(await header(page) === 'Toutes', 'aucun contexte précédent → « Toutes ▾ » (jamais une boutique prise au hasard)')
  ok(await ls(page, `shop_ctx_filter:${ms.id}`) === 'all', 'mémorisé pour CE compte : « all »')
  ok(await ls(page, `shop_ctx_active:${ms.id}`) === msProfile.shop_id, 'boutique active interne = boutique de rattachement du profil (règle explicite), le contexte affiché reste « Toutes »')

  console.log('\nSélection explicite, puis rechargement')
  await page.getByTestId('header-shop-context').click()
  await page.locator('button', { hasText: 'Marché Soleil Bonapriso' }).first().click(); await page.waitForTimeout(1500)
  await go(page)
  ok(await header(page) === 'Bonapriso', 'Bonapriso choisi → restauré au rechargement')
  ok(await ls(page, `shop_ctx_filter:${ms.id}`) === BONA && await ls(page, 'dashboard_shop_filter') === null, 'mémorisé sous la clé du compte (aucune clé commune à l’appareil)')

  console.log('\nSélection mémorisée devenue inaccessible')
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`shop_ctx_filter:${ms.id}`, ALPHA])
  await go(page)
  ok(await header(page) === 'Toutes' && await ls(page, `shop_ctx_filter:${ms.id}`) === 'all', 'boutique d’une autre entreprise mémorisée → « Toutes », mémoire corrigée')

  console.log('\nAnciennes clés communes (avant cette version) : une seule fois, et seulement si accessibles')
  await page.evaluate(v => localStorage.setItem('dashboard_shop_filter', v), AKWA)
  await go(page)
  ok(await header(page) === 'Akwa' && await ls(page, 'dashboard_shop_filter') === null && await ls(page, `shop_ctx_filter:${ms.id}`) === AKWA, 'ancienne clé valable → reprise, rattachée au compte, ancienne clé effacée')
  await page.evaluate(v => localStorage.setItem('dashboard_shop_filter', v), ALPHA)
  await go(page)
  ok(await header(page) === 'Toutes', 'ancienne clé d’une boutique inaccessible → « Toutes »')
  await page.getByTestId('header-shop-context').click()
  await page.locator('button', { hasText: 'Marché Soleil Akwa' }).first().click(); await page.waitForTimeout(1500)

  console.log('\nChangement de compte sur le même appareil')
  await loginAs(ctx, adm.email); await go(page)
  ok(await header(page) === 'Toutes', 'compte suivant (2 boutiques, aucune mémoire) → « Toutes », le choix « Akwa » du compte précédent n’est pas repris')
  ok(await ls(page, `shop_ctx_filter:${ms.id}`) === AKWA && await ls(page, `shop_ctx_filter:${adm.id}`) === 'all', 'mémoires séparées : Marché Soleil garde « Akwa », le compte de test a la sienne')
  const admShops = (await db.from('shop_members').select('shop_id').eq('user_id', adm.id).eq('is_active', true)).data.map(x => x.shop_id)
  const admTotal = (await db.from('products').select('id', { count: 'exact', head: true }).in('shop_id', admShops).eq('is_active', true)).count
  // Le compteur se remplit après le chargement des produits du nouveau compte (échec intermittent du 29 oct. : lu à 0)
  let count = 0
  for (let i = 0; i < 20 && count !== admTotal; i++) {
    count = Number(((await page.getByTestId('products-count').innerText().catch(() => '')).match(/\d+/) || [0])[0])
    if (count !== admTotal) await page.waitForTimeout(500)
  }
  ok(count === admTotal, `données du compte suivant uniquement : ${count} produits (ses 2 boutiques : ${admTotal})`)
  await loginAs(ctx, ms.email); await go(page)
  ok(await header(page) === 'Akwa', 'retour au premier compte → sa propre sélection « Akwa » restaurée')
  await ctx.close()

  console.log('\nCompte à une seule boutique (caissier d’Alpha)')
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }); await guard(ctx)
  await ctx.addInitScript(() => { try { localStorage.setItem('auth_remember_me', '1') } catch {} })
  page = await ctx.newPage()
  await loginAs(ctx, cash.email); await go(page, '/fr/dashboard')
  ok(await ls(page, `shop_ctx_filter:${cash.id}`) === ALPHA && await page.getByTestId('header-shop-context').count() === 0, 'sa seule boutique sélectionnée, aucun sélecteur affiché')
  await ctx.close()

  await browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
