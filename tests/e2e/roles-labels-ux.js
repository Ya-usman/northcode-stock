// Lot 1 des rôles, partie A (6 nov. 2026) : noms clairs dans les trois langues (Administrateur = shop_manager,
// Responsable de boutique = manager, Inventory manager), une phrase « ce qu'il peut faire » sous chaque choix de
// rôle, colonne Responsable de la page Boutiques, alerte « nouvelle vente » de l'Administrateur.
// LECTURE SEULE : compte vitrine Marché Soleil, toute écriture est interceptée (rien n'est envoyé).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/roles-labels-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const fs = require('fs')
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const AKWA = fs.readFileSync(__dirname + '/out/vitrine/akwa-id.txt', 'utf8').trim()
const msgs = Object.fromEntries(['fr', 'en', 'ha'].map(l => [l, JSON.parse(fs.readFileSync(`${__dirname}/../../messages/${l}.json`, 'utf8'))]))
const read = p => fs.readFileSync(`${__dirname}/../../${p}`, 'utf8')
let pass = 0, fail = 0
const ok = (c, msg, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))
const norm = s => String(s || '').replace(/\s+/g, ' ').trim()
const ROLES = ['owner', 'shop_manager', 'manager', 'accountant', 'stock_manager', 'cashier', 'viewer']

async function open(locale, width = 1366, height = 900) {
  const s = await session({ width, height, scale: 1, locale })
  await s.page.context().addInitScript(([shop]) => { try { localStorage.setItem('dashboard_shop_filter', shop); localStorage.setItem('active_shop_id', shop) } catch {} }, [AKWA])
  const sent = [], errors = []
  s.page.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await s.page.route(/\/(api|rest\/v1)\//, async route => {
    const r = route.request(), u = new URL(r.url())
    if (['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || /auth\/v1\/token/.test(u.pathname)) return route.fallback()
    const w = `${r.method()} ${u.pathname}`
    if (!['POST /api/auth/set-role', 'PATCH /rest/v1/profiles', 'POST /api/reports/margin', 'POST /api/team/status'].includes(w)) sent.push(w)
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return { ...s, sent, errors }
}

;(async () => {
  console.log('1. Noms et phrases des rôles (fr / en / ha)')
  const fr = msgs.fr, en = msgs.en, ha = msgs.ha
  ok(fr.roles.shop_manager === 'Administrateur' && fr.roles.manager === 'Responsable de boutique', 'fr : Administrateur, Responsable de boutique', fr.roles)
  ok(en.roles.shop_manager === 'Administrator' && en.roles.manager === 'Store manager' && en.roles.stock_manager === 'Inventory manager', 'en : Administrator, Store manager, Inventory manager', en.roles)
  ok(!/Responsable/.test(JSON.stringify(en.roles)) && !/\bManager\b/.test(JSON.stringify(ha.roles)), 'plus de français en anglais, plus d\'anglais en haoussa')
  ok(Object.values(en.roles).every(v => v === v[0] + v.slice(1).toLowerCase() || /StockShop/.test(v)), 'en : majuscule seulement au début', en.roles)
  for (const l of ['fr', 'en', 'ha']) {
    const d = msgs[l].roles_desc || {}
    const missing = [...ROLES, 'adjust'].filter(k => typeof d[k] !== 'string' || d[k].length < 20)
    ok(missing.length === 0, `${l} : une phrase par rôle + « accès réglables »`, missing)
    ok(!/[—–]|\(s\)/.test(JSON.stringify(d)), `${l} : ni tiret long ni « (s) »`)
    ok(msgs[l].settings.role_stock_manager === msgs[l].roles.stock_manager, `${l} : Paramètres et Équipe disent le même nom`, [msgs[l].settings.role_stock_manager, msgs[l].roles.stock_manager])
  }
  ok(/Paramètres, Accès par rôle/.test(fr.roles_desc.adjust) && /Settings, Role Permissions/.test(en.roles_desc.adjust), 'la phrase renvoie aux vrais noms du menu')
  ok(!/Manager|manager/.test(fr.settings.push_new_expense_hint + fr.shops.no_lead), 'fr : plus de « manager » dans les textes')

  console.log('\n2. Branchements')
  const layout = read('components/layout/app-layout.tsx'), shops = read('app/[locale]/(app)/shops/page.tsx'), settings = read('app/[locale]/(app)/settings/page.tsx')
  ok(/const isAdmin = [^\n]*'shop_manager'/.test(layout), 'alerte « nouvelle vente » : l\'Administrateur la reçoit')
  ok(/withRole\('manager'\)/.test(shops) && /withRole\('shop_manager'\)/.test(shops), 'Boutiques : Responsable de boutique, sinon Administrateur')
  ok(!/settings\.role_(cashier|viewer|stock_manager)/.test(settings), 'Paramètres : libellés des rôles lus dans « roles » (une seule source)')
  for (const f of ['components/team/invite-dialog.tsx', 'components/team/assign-dialog.tsx', 'components/team/member-sheet.tsx'])
    ok(/<RoleDescription /.test(read(f)), `phrase du rôle : ${f.split('/').pop()}`)

  console.log('\n3. Équipe (ordinateur, fr)')
  let v = await open('fr'), p = v.page
  await p.goto(`${BASE}/fr/team`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
  const cards = norm(await p.locator('[data-testid="member-card"]').allInnerTexts().then(a => a.join(' | ')))
  ok(/Jean-Paul Mbarga[^|]*Administrateur/.test(cards), 'Jean-Paul Mbarga : « Administrateur » (ex-Manager)', cards.slice(0, 300))
  ok(!/\bManager\b/.test(cards), 'plus aucun « Manager » affiché')
  // Invitation : phrase sous le rôle choisi, puis changement de rôle
  await p.getByTestId('team-invite').click(); await wait(800)
  const desc = () => p.getByTestId('role-desc').first().innerText().then(norm).catch(() => '')
  const d1 = await desc()
  ok(Object.values(fr.roles_desc).some(x => d1.startsWith(norm(x))), `invitation : phrase du rôle proposé (« ${d1.slice(0, 60)}… »)`, d1)
  ok(d1.includes(norm(fr.roles_desc.adjust)), 'invitation : « accès réglables par le propriétaire »')
  await p.getByTestId('invite-role').click(); await wait(400)
  await p.getByRole('option', { name: fr.roles.cashier, exact: true }).click(); await wait(400)
  ok((await desc()).startsWith(norm(fr.roles_desc.cashier)), 'invitation : Caissier → sa phrase', await desc())
  await p.screenshot({ path: OUT + '/roles-invite.png' })
  await p.keyboard.press('Escape'); await wait(600)
  // Fiche membre : choisir un autre rôle ouvre la confirmation avec la phrase du nouveau rôle ; on annule
  await p.locator('[data-testid="member-card"]', { hasText: 'Fatou Bello' }).first().click(); await wait(1500)
  const sel = p.getByTestId('member-role-select').first()
  if (await sel.count()) {
    await sel.click(); await wait(400)
    await p.getByRole('option', { name: fr.roles.manager, exact: true }).click(); await wait(600)
    const dlg = norm(await p.getByRole('alertdialog').or(p.getByRole('dialog')).last().innerText().catch(() => ''))
    ok(dlg.includes(norm(fr.roles_desc.manager)), 'changement de rôle : la confirmation dit ce que permet le nouveau rôle', dlg.slice(0, 300))
    await p.screenshot({ path: OUT + '/roles-change.png' })
    await p.getByRole('button', { name: /Annuler/ }).last().click().catch(() => {}); await wait(500)
  } else ok(false, 'fiche membre : sélecteur de rôle introuvable')
  ok(v.errors.length === 0 && v.sent.length === 0, `aucune erreur JS, rien envoyé (${v.errors.join(' | ')}${v.sent.join(',')})`)
  await v.browser.close()

  console.log('\n4. Boutiques : colonne Responsable')
  v = await open('fr'); p = v.page
  await p.goto(`${BASE}/fr/shops`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
  const akwa = norm(await p.locator('tr', { hasText: 'Marché Soleil Akwa' }).first().innerText().catch(() => ''))
  ok(/Jean-Paul Mbarga/.test(akwa), 'Akwa : l\'Administrateur affiché quand il n\'y a pas de Responsable (avant : « — »)', akwa)
  await p.screenshot({ path: OUT + '/roles-shops.png' })
  ok(v.errors.length === 0 && v.sent.length === 0, 'aucune erreur JS, rien envoyé')
  await v.browser.close()

  console.log('\n5. Anglais et haoussa')
  for (const [l, label] of [['en', 'Administrator'], ['ha', 'Mai gudanarwa']]) {
    v = await open(l); p = v.page
    await p.goto(`${BASE}/${l}/team`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(8000)
    const t = norm(await p.locator('[data-testid="member-card"]').allInnerTexts().then(a => a.join(' | ')))
    ok(t.includes(label) && !/Responsable/.test(t), `${l} : « ${label} », pas de français`, t.slice(0, 200))
    ok(v.errors.length === 0 && v.sent.length === 0, `${l} : aucune erreur JS, rien envoyé`)
    await v.browser.close()
  }

  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail + 1} échec(s), interrompu`); process.exit(1) })
