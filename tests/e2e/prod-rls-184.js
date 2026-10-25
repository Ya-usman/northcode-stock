// Migration 184 — contrôle EN LIGNE, LECTURE SEULE : ce que la base renvoie réellement à chaque compte (session réelle,
// clé publique, comme le navigateur). Dépenses / budgets : pour chaque boutique du compte, tout si le rôle a « Dépenses »
// (règle de lib/permissions, propriétaire toujours), sinon rien. Mouvements, transferts, affectations de lots : rien.
// Aucune écriture : uniquement des SELECT.
// Usage : node tests/e2e/prod-rls-184.js
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ACCOUNTS = ['ghislainx123@gmail.com', 'ghislainx123+jeanpaul@gmail.com', 'cassierstock@gmail.com', 'ghislainx123+mariam@gmail.com',
  'stocshopci+magasinier@gmail.com', 'ghislainx123+fatou@gmail.com', 'stocshopci@gmail.com', 'stocshopci+observateur@gmail.com']
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const count = async (db, table, col, shop) => {
  let q = db.from(table).select('id', { count: 'exact', head: true })
  if (shop) q = q.eq(col, shop)
  const { count: n, error } = await q
  return error ? `erreur ${error.code || error.message}` : n
}

;(async () => {
  const P = await import(pathToFileURL(path.join(ROOT, 'lib/permissions/index.ts')).href)
  const users = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users
  const shops = Object.fromEntries(((await admin.from('shops').select('id, name, role_permissions')).data || []).map(s => [s.id, s]))
  for (const email of ACCOUNTS) {
    const u = users.find(x => x.email === email)
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    const { error } = await db.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
    if (error) { ok(false, `${email} : connexion impossible (${error.message})`); continue }
    const members = (await admin.from('shop_members').select('shop_id, role').eq('user_id', u.id).eq('is_active', true)).data || []
    console.log(`${email}`)
    for (const m of members) {
      const s = shops[m.shop_id]; const allowed = m.role === 'owner' || P.canView(s?.role_permissions, m.role, 'expenses')
      for (const t of ['expenses', 'expense_budgets']) {
        const real = await count(admin, t, 'shop_id', m.shop_id), seen = await count(db, t, 'shop_id', m.shop_id)
        ok(seen === (allowed ? real : 0), `${(s?.name || m.shop_id).slice(0, 26).padEnd(26)} ${m.role.padEnd(13)} ${t.padEnd(15)} droit ${allowed ? 'oui' : 'non'} → lu ${seen} / ${real}`)
      }
    }
    const blocked = []
    for (const t of ['stock_movements', 'stock_transfers', 'sale_item_batches']) blocked.push(`${t} ${await count(db, t)}`)
    ok(blocked.every(x => / 0$/.test(x)), `mouvements, transferts, affectations : rien (${blocked.join(', ')})`)
    // Session de CE script seulement (« global » déconnecterait aussi les navigateurs ouverts sur ce compte, tests compris)
    await db.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  ok(await count(anon, 'expenses') === 0, 'anonyme : aucune dépense')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
