// Session navigateur connectée (lien magique via la clé serveur, jamais affichée) pour les tests StockShop.
// Recréé le 23 oct. 2026 (l'ancien helper vivait dans un dossier temporaire, vidé par le système).
//
// PROTECTION PERMANENTE (validée le 14 oct. 2026) :
//   • CAPTURE_BASE est obligatoire — aucune adresse par défaut ;
//   • toute adresse hors serveur local exige CAPTURE_PROD_READONLY=1, réservé aux contrôles EN LIGNE de pure
//     lecture ; dans ce mode, TOUTE écriture du navigateur est bloquée (réponse 204), sans exception.
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../../..')
const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))
const { chromium } = require('playwright-core')

if (!process.env.CAPTURE_BASE) throw new Error('CAPTURE_BASE obligatoire (ex. http://localhost:3000) — aucune adresse par défaut')
const BASE = process.env.CAPTURE_BASE
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)
if (!LOCAL && process.env.CAPTURE_PROD_READONLY !== '1') {
  throw new Error(`Adresse refusée : ${BASE}. Hors serveur local, CAPTURE_PROD_READONLY=1 est obligatoire (contrôle en ligne en lecture seule uniquement)`)
}
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const DOMAIN = new URL(BASE).hostname
const SECURE = BASE.startsWith('https')

async function session({ width = 1366, height = 900, scale = 1, locale = 'fr', email = process.env.CAPTURE_EMAIL } = {}) {
  if (!email) throw new Error('CAPTURE_EMAIL obligatoire')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr) throw new Error('lien magique : ' + linkErr.message)
  const { data, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (error) throw new Error('connexion : ' + error.message)
  const value = 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64url')
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: width < 900, hasTouch: true, serviceWorkers: 'block', locale: locale === 'fr' ? 'fr-FR' : 'en-US' })
  const parts = []; for (let i = 0; i < value.length; i += 3180) parts.push(value.slice(i, i + 3180))
  await ctx.addCookies([
    ...parts.map((p, i) => ({ name: `sb-${REF}-auth-token.${i}`, value: p, domain: DOMAIN, path: '/', secure: SECURE })),
    { name: 'NEXT_LOCALE', value: locale, domain: DOMAIN, path: '/', secure: SECURE },
  ])
  await ctx.addInitScript(() => { try { localStorage.setItem('auth_remember_me', '1') } catch {} })
  if (process.env.PIN_SHOP) await ctx.addInitScript(id => { try { if (!sessionStorage.getItem('__pin')) { sessionStorage.setItem('__pin', '1'); localStorage.setItem('dashboard_shop_filter', id) } } catch {} }, process.env.PIN_SHOP)
  const page = await ctx.newPage()
  await page.route('**/*', async route => {
    const r = route.request(), url = r.url(), method = r.method()
    if (method === 'GET' && /\/rest\/v1\/announcements\?/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    // Horaires d'ouverture neutralisés dans CE navigateur seulement (aucune écriture)
    if (method === 'GET' && /\/rest\/v1\/(shops|shop_members)\?/.test(url)) {
      const res = await route.fetch()
      return route.fulfill({ response: res, body: (await res.text()).replace(/"hours_enabled":\s*true/g, '"hours_enabled":false') })
    }
    // Écritures : TOUJOURS bloquées (production comme local). Un test qui veut lire ce qui part déclare ses propres
    // routes, plus prioritaires, qui interceptent et relisent le corps — jamais de passage vers le serveur ici.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !/\/auth\/v1\/token/.test(url)) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
  return { browser, ctx, page }
}

module.exports = { session, BASE, LOCAL }
