// Étape D — accès DIRECT par l'adresse aux écrans masqués pour un rôle (EN LIGNE, LECTURE SEULE). Pour chaque écran,
// on compare le droit « voir » (règle réelle, réglages relus en base) à ce que l'écran affiche quand on tape l'adresse.
// Usage : OUT_DIR=<dossier> EMAIL=<compte> SHOP=<boutique> node tests/e2e/d-direct-url.js
process.env.CAPTURE_BASE = 'https://stockshop.tech'
process.env.CAPTURE_PROD_READONLY = '1'
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const OUT = process.env.OUT_DIR || path.join(__dirname, 'out', 'd-direct-url'); fs.mkdirSync(OUT, { recursive: true })
const EMAIL = process.env.EMAIL || 'stocshopci+observateur@gmail.com', SHOP = process.env.SHOP || 'a0000000-0000-0000-0000-000000000001'
const wait = ms => new Promise(r => setTimeout(r, ms))
const PAGES = [
  ['stock/products', 'stock'], ['stock', 'stock'], ['stock/expiry', 'expiry_list'], ['stock/movements', 'movements'], ['stock/transfers', 'transfers'],
  ['stock/inventory-count', 'inventory_count'], ['categories', 'categories'], ['suppliers', 'suppliers'], ['payments', 'payments'],
  ['customers', 'customers'], ['sales/history', 'sales_history'], ['expenses', 'expenses'], ['reports', 'reports'], ['notes', 'notes'], ['caisse', 'caisse'],
]
;(async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'lib/permissions/index.ts')).href)
  const u = (await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(x => x.email === EMAIL)
  const role = (await db.from('shop_members').select('role').eq('shop_id', SHOP).eq('user_id', u.id).single()).data.role
  const rp = (await db.from('shops').select('role_permissions').eq('id', SHOP).single()).data.role_permissions
  process.env.CAPTURE_EMAIL = EMAIL; process.env.PIN_SHOP = SHOP
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  console.log(`${EMAIL} (${role})`)
  for (const [p, feature] of PAGES) {
    const allowed = P.canView(rp, role, feature)
    const reads = []
    const h = r => { const url = r.url(); if (r.status() === 200 && /\/rest\/v1\/|\/api\//.test(url) && r.request().method() === 'GET') reads.push(url.replace(/^.*\/(rest\/v1|api)\//, '').replace(/\?.*/, '')) }
    s.page.on('response', h)
    await s.page.goto(`${BASE}/fr/${p}`, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {})
    await wait(6000)
    s.page.off('response', h)
    const finalPath = new URL(s.page.url()).pathname.replace(/^\/fr\//, '')
    const text = (await s.page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
    const blocked = finalPath !== p.split('?')[0] || /accès|autoris|pas le droit|Aucun accès|no access/i.test(text.slice(0, 400))
    const shopReads = [...new Set(reads.filter(r => !/^(profiles|shops|shop_members|entities|entity_members|announcements|user_|app-version|whats|subscriptions|notifications|admin_notifications|support|referral)/.test(r)))]
    const verdict = allowed ? 'autorisé' : (blocked ? 'BLOQUÉ' : 'OUVERT malgré le masquage')
    console.log(`  ${p.padEnd(22)} droit ${allowed ? 'oui' : 'NON'} → ${verdict}${!allowed && !blocked ? ` · données lues : ${shopReads.slice(0, 6).join(', ') || 'aucune'}` : ''}`)
    if (!allowed && !blocked) await s.page.screenshot({ path: path.join(OUT, `ouvert-${p.replace(/[^a-z]+/g, '-')}.png`) })
  }
  await s.browser.close().catch(() => {})
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
