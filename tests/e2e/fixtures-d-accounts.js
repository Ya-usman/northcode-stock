// Étape D — création des deux comptes internes de test PERMANENTS de Boutique Alpha (accord du 25 oct. 2026) :
//   stocshopci+observateur@gmail.com  rôle viewer         (« TEST Observateur »)
//   stocshopci+magasinier@gmail.com   rôle stock_manager  (« TEST Magasinier »)
// Par le parcours NORMAL : le propriétaire d'Alpha invite depuis le navigateur (POST /api/team/invite). Mode écriture :
// serveur local, cible vérifiée en base, seule la route d'invitation autorisée et seulement pour Alpha. Rien n'est
// supprimé (comptes conservés) ; la photo avant / après doit montrer UNIQUEMENT les lignes attendues.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/fixtures-d-accounts.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const { openPage } = require('./lib/session.js')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const ACCOUNTS = [
  { email: 'stocshopci+observateur@gmail.com', full_name: 'TEST Observateur', role: 'viewer' },
  { email: 'stocshopci+magasinier@gmail.com', full_name: 'TEST Magasinier', role: 'stock_manager' },
]

;(async () => {
  const W = await enableWrite({ test: 'étape D — comptes de test', routes: [/\/api\/team\/invite$/] })
  for (const a of ACCOUNTS) {
    const { data } = await W.db.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if ((data?.users || []).some(u => u.email === a.email)) { console.error(`ARRÊT : ${a.email} existe déjà — rien n'est fait`); process.exit(2) }
  }
  const s = await openPage({ width: 1280, height: 900, skipGoto: true, email: 'admin@northcode.ng', write: W })
  await s.page.goto('http://localhost:3000/fr/offline', { waitUntil: 'domcontentloaded' })
  const api = (method, url, body) => s.page.evaluate(async ({ method, url, body }) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json() } catch {} return { status: r.status, json: j } }, { method, url, body })

  for (const a of ACCOUNTS) {
    const r = await api('POST', '/api/team/invite', { ...a, shop_id: ALPHA })
    ok(r.status === 200 && r.json.success, `invitation ${a.full_name} (${a.role}) : ${r.status}${r.json.error ? ' — ' + r.json.error : ''}`)
  }
  await s.browser.close()

  // Contrôle : uniquement les lignes attendues, rien de préexistant touché
  const v = await W.verify()
  ok(v.removed.length === 0, `lignes préexistantes supprimées : ${v.removed.length}`)
  ok(v.modified.length === 0, `lignes préexistantes modifiées : ${v.modified.length}${v.modified.length ? ' → ' + v.modified.join(' | ') : ''}`)
  const byTable = {}
  for (const r of v.remaining) { const t = r.split(' ')[0]; byTable[t] = (byTable[t] || 0) + 1 }
  console.log('  nouvelles lignes :', JSON.stringify(byTable))
  ok(byTable.shop_members === 2 && byTable.profiles === 2 && byTable.audit_logs === 2 && Object.keys(byTable).length === 3,
     'nouvelles lignes = exactement 2 adhésions, 2 profils, 2 entrées de journal (member.invite)')

  const users = (await W.db.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.filter(u => ACCOUNTS.some(a => a.email === u.email))
  for (const a of ACCOUNTS) {
    const u = users.find(x => x.email === a.email)
    const m = u && (await W.db.from('shop_members').select('role, is_active').eq('shop_id', ALPHA).eq('user_id', u.id).single()).data
    ok(!!u && m?.role === a.role && m?.is_active === true, `${a.full_name} : compte créé, membre actif d'Alpha, rôle ${m?.role}`)
    if (u) console.log(`    ${a.email} → ${u.id}`)
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
