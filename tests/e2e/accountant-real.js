// Lot Rôles, partie B — TEST RÉEL du rôle Comptable (accord de l'utilisateur du 6 nov. 2026), Boutique Alpha :
//   1. un Responsable de boutique tente d'inviter un Comptable → refusé (rôle financier) ; le propriétaire l'invite
//      par le parcours normal : stocshopci+comptable@gmail.com (« TEST Comptable »), compte de test PERMANENT ;
//   2. connecté comme le Comptable : la base lui donne les ventes de TOUTE la boutique (règle 214) et les dépenses ;
//      les routes lui donnent les prix d'achat ; les écrans lui montrent les chiffres, sans caisse, équipe ni réglages ;
//   3. il tente d'écrire (dépense, client, produit, invitation, réglages des droits) → chaque fois refusé par le SERVEUR.
// Mode écriture : serveur local, cible vérifiée en base, routes déclarées seulement, Alpha seulement. Photo avant / après :
// aucune ligne préexistante touchée ; seules traces attendues : l'adhésion, le profil et le journal de l'invitation.
// Usage : CAPTURE_BASE=http://localhost:3007 node tests/e2e/accountant-real.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const { openPage } = require('./lib/session.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(path.join(ROOT, 'node_modules/@supabase/supabase-js'))
const BASE = process.env.CAPTURE_BASE
const OUT = __dirname + '/out'
const ACC = { email: 'stocshopci+comptable@gmail.com', full_name: 'TEST Comptable', role: 'accountant' }
const MANAGER = 'cassierstock@gmail.com'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').trim()

// Client « navigateur » (clé publique + session de la personne) : la base applique ses règles de lecture
async function asUser(admin, email) {
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: link, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (e1) throw new Error('lien magique : ' + e1.message)
  const { error: e2 } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (e2) throw new Error('connexion : ' + e2.message)
  return anon
}

;(async () => {
  const W = await enableWrite({
    test: 'rôle Comptable — test réel',
    routes: [/\/api\/team\/invite$/, /\/api\/expenses$/, /\/api\/customers$/, /\/api\/products$/, /\/api\/team\/permissions$/],
  })
  const admin = W.db
  const exists = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(u => u.email === ACC.email)
  // Compte de test PERMANENT : invité à la 1re exécution ; ensuite on vérifie qu'il est toujours le Comptable d'Alpha
  if (exists) {
    const m = (await admin.from('shop_members').select('role, shop_id').eq('user_id', exists.id)).data || []
    if (m.length !== 1 || m[0].shop_id !== ALPHA || m[0].role !== 'accountant') { console.error(`ARRÊT : ${ACC.email} existe mais n'est pas le Comptable d'Alpha attendu — rien n'est fait`); process.exit(2) }
  }
  const call = (s, method, url, body) => s.page.evaluate(async ({ method, url, body }) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    let t = ''; try { t = await r.text() } catch {} return { status: r.status, t: t.slice(0, 4000) }
  }, { method, url, body })

  console.log('1. Invitation')
  const mgr = await openPage({ width: 1280, height: 900, skipGoto: true, email: MANAGER, write: W })
  await mgr.page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded' })
  const mgrRole = (await admin.from('shop_members').select('role').eq('shop_id', ALPHA).eq('user_id', (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(u => u.email === MANAGER).id).single()).data?.role
  const r0 = await call(mgr, 'POST', '/api/team/invite', { ...ACC, shop_id: ALPHA })
  ok(mgrRole === 'manager' && r0.status === 403, `Responsable de boutique (${mgrRole}) : invitation d'un Comptable refusée (${r0.status})`, r0.t.slice(0, 200))
  await mgr.browser.close()

  if (!exists) {
    const owner = await openPage({ width: 1280, height: 900, skipGoto: true, email: 'admin@northcode.ng', write: W })
    await owner.page.goto(`${BASE}/fr/offline`, { waitUntil: 'domcontentloaded' })
    const r1 = await call(owner, 'POST', '/api/team/invite', { ...ACC, shop_id: ALPHA })
    ok(r1.status === 200 && /"success":true/.test(r1.t), `propriétaire : invitation de TEST Comptable (${r1.status})`, r1.t.slice(0, 300))
    await owner.browser.close()
  } else console.log('  (TEST Comptable existe déjà : compte de test permanent, invitation non rejouée)')
  const accUser = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find(u => u.email === ACC.email)
  const mem = accUser && (await admin.from('shop_members').select('role, is_active').eq('shop_id', ALPHA).eq('user_id', accUser.id).single()).data
  ok(!!accUser && mem?.role === 'accountant' && mem?.is_active, `compte créé, membre actif d'Alpha, rôle ${mem?.role}`)
  if (!accUser) { console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) }

  console.log('\n2. Lectures directes de la base (règles de la 214)')
  const acc = await asUser(admin, ACC.email)
  const ownerDb = await asUser(admin, 'admin@northcode.ng')
  const count = async (c, table) => { const { count: n, error } = await c.from(table).select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA); return error ? 'erreur ' + error.message : n }
  const [aSales, oSales, aExp, oExp] = [await count(acc, 'sales'), await count(ownerDb, 'sales'), await count(acc, 'expenses'), await count(ownerDb, 'expenses')]
  ok(typeof aSales === 'number' && aSales > 0 && aSales === oSales, `ventes d'Alpha : ${aSales} pour le Comptable, ${oSales} pour le propriétaire (toute la boutique)`)
  ok(typeof aExp === 'number' && aExp === oExp, `dépenses d'Alpha : ${aExp} pour le Comptable, ${oExp} pour le propriétaire`)
  const ins = await acc.from('expenses').insert({ shop_id: ALPHA, amount: 1, description: 'TEST ' + W.RUN, date: '2026-11-06', category: 'other' }).select('id')
  ok(!!ins.error, `écriture directe dans la base refusée (${ins.error?.code || 'acceptée !'})`)

  console.log('\n3. Comptable connecté : routes et écrans')
  const s = await openPage({ width: 1366, height: 900, skipGoto: true, email: ACC.email, write: W })
  await s.page.context().addInitScript(([shop]) => { try { localStorage.setItem('dashboard_shop_filter', shop); localStorage.setItem('active_shop_id', shop) } catch {} }, [ALPHA])
  // Marge des Rapports : lecture demandée en POST (calcul côté serveur, aucune écriture) ; elle doit atteindre le serveur
  await s.page.route(/\/api\/reports\/margin$/, r => r.continue())
  const errors = []; s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await s.page.goto(`${BASE}/fr/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000)
  const costs = await call(s, 'GET', `/api/costs?shop_ids=${ALPHA}`)
  ok(costs.status === 200 && /\d/.test(costs.t), `prix d'achat : /api/costs ${costs.status}`)
  const nav = norm(await s.page.locator('aside nav').innerText().catch(() => ''))
  ok(/Tableau de bord/.test(nav) && /Historique des ventes/.test(nav) && /Rapports/.test(nav) && /Dépenses/.test(nav) && /Stock/.test(nav), 'menu : tableau de bord, historique, rapports, dépenses, stock', nav)
  ok(!/Nouvelle vente|Contrôle de caisse|Équipe|Paramètres|Abonnement|Notes/.test(nav), 'menu : ni vente, ni caisse, ni équipe, ni réglages, ni abonnement, ni notes', nav)
  const main = norm(await s.page.locator('main').innerText().catch(() => ''))
  ok(/F CFA|FCFA|XAF|\d[\d\s ]*F\b/.test(main), 'tableau de bord : montants affichés (pas de tirets comme pour l\'Observateur)', main.slice(0, 300))
  // Chiffre de la boutique (215) : oui par défaut, mais le réglage RÉEL d'Alpha décide (un « non » dans l'onglet Général
  // l'emporte pour tout le monde). L'écran et le serveur doivent suivre la même règle, dans un sens comme dans l'autre.
  const P = await import(path.join(ROOT, 'lib/permissions/index.ts').replace(/\\/g, '/').replace(/^([A-Z]):/, 'file:///$1:'))
  const stored = (await admin.from('shops').select('role_permissions').eq('id', ALPHA).single()).data?.role_permissions
  const expectCa = P.canView(stored, 'accountant', 'revenue_chart')
  console.log(`  (réglage d'Alpha : chiffre de la boutique ${expectCa ? 'ouvert' : 'masqué'} pour le Comptable${stored?.general?.revenue_chart === false ? ', masqué pour tous dans « Général »' : ''})`)
  ok(/Encaissements du mois/.test(main) === expectCa, `tableau de bord : encaissements du mois de la boutique ${expectCa ? 'affichés' : 'masqués'}, comme le réglage`, main.slice(0, 400))
  const now = new Date(), from = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()
  const er = await call(s, 'GET', `/api/dashboard/expense-revenue?shop_ids=${ALPHA}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(now.toISOString())}`)
  ok(er.status === (expectCa ? 200 : 403), `graphique revenus / dépenses / résultat : ${er.status}, comme le réglage`, er.t.slice(0, 200))
  ok(!/Mes encaissements du mois/.test(main),'tableau de bord : pas de « Mes encaissements du mois » (il n\'encaisse pas)', main.slice(0, 400))
  await s.page.screenshot({ path: OUT + '/accountant-dashboard.png' })
  if (/Bienvenue dans l’équipe/.test(main)) {
    ok(/Votre accès est en lecture seule/.test(main) && !/la caisse, le stock/.test(main), 'carte d\'accueil : texte « lecture seule », sans la caisse', main.slice(0, 300))
    // Visite express jusqu'au bout : ni étape « Vendre », ni « Prochaine étape : ajouter un produit » (enregistrement bloqué, rien n'est écrit)
    await s.page.getByTestId('tw-start').click(); await wait(1200)
    const bubble = () => s.page.getByTestId('tour-bubble').innerText().then(norm).catch(() => '')
    const seen = []
    for (let i = 0; i < 10; i++) {
      const b = await bubble(); seen.push(b)
      if (!(await s.page.getByTestId('tour-next').count())) break
      await s.page.getByTestId('tour-next').click(); await wait(700)
    }
    const last = seen[seen.length - 1] || ''
    ok(seen.length === 6 && /6\/6/.test(last), `visite express : 6 étapes au lieu de 7 (${seen.length})`, seen.map(x => x.slice(0, 40)))
    ok(!seen.some(x => /Vendre|La caisse/.test(x)), 'visite express : pas d\'étape « Vendre »', seen.map(x => x.slice(0, 60)))
    ok(/page Aide/.test(last) && !/Prochaine étape/.test(last) && !(await s.page.getByTestId('tour-chain').count()), 'visite express : fin sans « ajouter votre premier produit »', last)
    await s.page.screenshot({ path: OUT + '/accountant-tour-end.png' })
    await s.page.getByTestId('tour-finish').click().catch(() => {}); await wait(500)
  } else console.log('  (carte d\'accueil déjà masquée pour ce compte : visite non rejouée)')
  for (const [p, re] of [['/fr/sales/history', /Historique/], ['/fr/expenses', /Dépenses/], ['/fr/reports', /Rapports|Marge|Bénéfice/]]) {
    await s.page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(7000)
    const txt = norm(await s.page.locator('main').innerText().catch(() => ''))
    ok(re.test(txt) && !/Accès refusé|permission/i.test(txt), `${p} : page ouverte`, txt.slice(0, 200))
    if (p === '/fr/reports') { ok(/Marge|Bénéfice/.test(txt), 'Rapports : marge / bénéfice visibles (droit aux prix d\'achat)', txt.slice(0, 300)); await s.page.screenshot({ path: OUT + '/accountant-reports.png' }) }
    if (p === '/fr/expenses') {
      const add = await s.page.getByRole('button', { name: /Nouvelle dépense|Ajouter/ }).count()
      ok(add === 0, 'Dépenses : aucun bouton d\'ajout', add)
    }
  }
  await s.page.goto(`${BASE}/fr/caisse`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
  ok(!/\/fr\/caisse$/.test(new URL(s.page.url()).pathname) || /Accès|autoris/i.test(norm(await s.page.locator('main').innerText().catch(() => ''))), `Contrôle de caisse : inaccessible (${new URL(s.page.url()).pathname})`)

  console.log('\n4. Tentatives d\'écriture : refusées par le serveur')
  const tries = [
    ['dépense', 'POST', '/api/expenses', { shop_id: ALPHA, amount: 100, description: 'TEST ' + W.RUN, date: '2026-11-06', category: 'other', payment_method: 'cash' }],
    ['client', 'POST', '/api/customers', { shop_id: ALPHA, name: 'TEST ' + W.RUN }],
    ['produit', 'POST', '/api/products', { shop_id: ALPHA, name: 'TEST ' + W.RUN, selling_price: 100, quantity: 1 }],
    ['invitation', 'POST', '/api/team/invite', { email: `stocshopci+${W.RUN}@gmail.com`, full_name: 'TEST ' + W.RUN, role: 'cashier', shop_id: ALPHA }],
    ['réglages des droits', 'PATCH', '/api/team/permissions', { shop_id: ALPHA, role_permissions: { accountant: { expenses_write: true } } }],
  ]
  for (const [label, method, url, body] of tries) {
    const r = await call(s, method, url, body)
    ok(r.status === 403, `${label} : refusé (${r.status})`, r.t.slice(0, 200))
  }
  ok(errors.length === 0, `aucune erreur JS (${errors.join(' | ')})`)
  await s.browser.close()

  console.log('\n5. Photo avant / après')
  const rep = await W.cleanup({
    expenses: r => String(r.description || '').includes(W.RUN),
    customers: r => String(r.name || '').includes(W.RUN),
    products: r => String(r.name || '').includes(W.RUN),
  })
  for (const t of ['expenses', 'customers', 'products']) ok(!rep[t], `${t} : aucune ligne créée`, rep[t])
  const v = await W.verify()
  ok(v.removed.length === 0, `lignes préexistantes supprimées : ${v.removed.length}`, v.removed)
  ok(v.modified.length === 0, `lignes préexistantes modifiées : ${v.modified.length}`, v.modified)
  const byTable = {}
  for (const r of v.remaining) { const t = r.split(' ')[0]; byTable[t] = (byTable[t] || 0) + 1 }
  console.log('  nouvelles lignes :', JSON.stringify(byTable))
  if (exists) ok(v.remaining.length === 0, 'aucune nouvelle ligne', v.remaining)
  else ok(byTable.shop_members === 1 && byTable.profiles === 1 && byTable.audit_logs === 1 && Object.keys(byTable).length === 3,
    'nouvelles lignes = exactement l\'adhésion, le profil et le journal de l\'invitation', v.remaining)
  console.log(`    ${ACC.email} → ${accUser.id}`)

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail + 1} échec(s), interrompu`); process.exit(1) })
