// Réception d'un transfert depuis la boutique d'ARRIVÉE seulement (1er nov. 2026, remarque de l'utilisateur : dans Akwa,
// boutique de DÉPART de TR-2026-0002, il voyait « Réceptionner »). LECTURE SEULE, serveur local, compte vitrine Marché
// Soleil (propriétaire des 3 boutiques : droit de réception sur l'arrivée quelle que soit la boutique affichée) :
//  - Akwa (départ) : « En transit vers Bastos », ni « Réceptionner » ni « Passer sur » (carte, détail) ; page de
//    réception ouverte par lien → « destiné à … Bastos » + « Passer sur … » ;
//  - Bastos (arrivée) : « Réceptionner » ;
//  - « Toutes » : « À réceptionner à Bastos » + « Passer sur Bastos » (pas de réception directe) ; le bouton choisit
//    Bastos et la carte propose alors « Réceptionner » ;
//  - serveur : réception refusée (409) depuis Akwa ou sans boutique ; depuis Bastos, le contrôle suivant (lignes
//    invalides EXPRÈS) répond 400 : aucune réception ne peut aboutir, rien n'est écrit.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/transfer-receive-context.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1', BASTOS = 'abec3e3f-3e92-4ff0-a374-d2d88f57899b'
const REF = 'TR-2026-0002'
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

async function open(shop, path) {
  const s = await session({ width: 390, height: 844, scale: 1, locale: 'fr' })
  await s.page.addInitScript(([id]) => { try { if (!sessionStorage.getItem('__ctx')) { sessionStorage.setItem('__ctx', '1'); localStorage.setItem('dashboard_shop_filter', id || 'all'); localStorage.setItem('active_shop_id', id || 'abec3e3f-3e92-4ff0-a374-d2d88f57899b') } } catch {} }, [shop])
  s.errors = []; s.page.on('pageerror', e => s.errors.push(e.message.slice(0, 120)))
  s.writes = []; s.page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method()) && /stock-transfers/.test(r.url())) s.writes.push(r.url()) })
  await s.page.goto(`${BASE}/fr/${path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  return s
}
const card = page => page.locator('[data-testid="transfer-card"]', { hasText: REF }).first()

;(async () => {
  const { data: tr } = await db.from('stock_transfers').select('id, status, source_shop_id, destination_shop_id, received_at').eq('reference', REF).eq('source_shop_id', AKWA).single()
  ok(tr && tr.status === 'sent' && tr.destination_shop_id === BASTOS, `${REF} : Akwa → Bastos, en transit (lu en base)`, tr)
  if (!tr || tr.status !== 'sent') { console.log('Arrêt : le transfert n’est plus en transit, cas non exécutable.'); process.exit(1) }

  for (const [label, shop] of [['Akwa (départ)', AKWA], ['Bastos (arrivée)', BASTOS], ['Toutes les boutiques', null]]) {
    console.log(`\n${label}`)
    const s = await open(shop, 'stock/transfers'); const page = s.page
    await page.getByTestId('transfers-list').waitFor({ timeout: 60000 }); await wait(2500)
    const c = card(page)
    ok(await c.count() === 1, `carte ${REF} affichée`)
    const receive = await c.locator('[data-testid="transfer-receive"]').count() === 1
    const sw = await c.locator('[data-testid="transfer-switch"]').count() === 1
    const waiting = (await c.locator('[data-testid="transfer-waiting"]').innerText()).trim()
    if (shop === AKWA) {
      ok(!receive && !sw, 'carte : ni « Réceptionner » ni « Passer sur »')
      ok(/^En transit vers .*Bastos/.test(waiting), `carte : « ${waiting} »`)
      await c.locator('[data-testid="transfer-view"]').click()
      await page.getByTestId('transfer-detail').waitFor({ timeout: 15000 }); await wait(2500)
      ok(await page.getByTestId('detail-receive').count() === 0 && await page.getByTestId('detail-switch').count() === 0, 'détail : ni « Réceptionner » ni « Passer sur »')
      ok(await page.getByTestId('detail-qr').count() === 1, 'détail : le QR du bon reste disponible')
      await page.screenshot({ path: `${__dirname}/out/transfer-akwa-detail.png` })
    } else if (shop === BASTOS) {
      ok(receive && !sw, 'carte : « Réceptionner »')
    } else {
      ok(!receive && sw, 'carte : « Passer sur … », pas de réception directe')
      ok(/^À réceptionner à .*Bastos/.test(waiting) && /Bastos/.test(await c.locator('[data-testid="transfer-switch"]').innerText()), `carte : « ${waiting} » · « ${(await c.locator('[data-testid="transfer-switch"]').innerText()).trim()} »`)
      await c.scrollIntoViewIfNeeded(); await c.screenshot({ path: `${__dirname}/out/transfer-all-card.png` })
      await c.locator('[data-testid="transfer-switch"]').click(); await wait(3500)
      const filter = await page.evaluate(() => localStorage.getItem('dashboard_shop_filter'))
      const c2 = card(page)
      await c2.locator('[data-testid="transfer-receive"]').waitFor({ timeout: 20000 }).catch(() => {})
      ok(await c2.locator('[data-testid="transfer-receive"]').count() === 1, `après « Passer sur » : boutique choisie = Bastos (${filter === BASTOS ? 'oui' : filter}), « Réceptionner » proposé`)
    }
    ok(!s.writes.length, `aucune écriture sur les transferts (${s.writes.length})`, s.writes)
    ok(!s.errors.length, 'aucune erreur JavaScript', s.errors)
    await s.browser.close()
  }

  console.log('\nPage de réception ouverte par lien, depuis Akwa')
  {
    const s = await open(AKWA, `stock/transfers/${tr.id}/receive`); const page = s.page
    await page.getByTestId('receive-blocked').waitFor({ timeout: 60000 }).catch(() => {})
    const txt = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
    ok(/destiné à Marché Soleil Bastos/.test(txt), `message : « ${(txt.match(/Ce transfert[^.]*\./) || [''])[0]} »`)
    ok(await page.getByTestId('receive-switch').count() === 1 && /Bastos/.test(await page.getByTestId('receive-switch').innerText()), 'bouton « Passer sur Marché Soleil Bastos »')
    await page.screenshot({ path: `${__dirname}/out/transfer-akwa-receive-page.png` })
    await page.getByTestId('receive-switch').click()
    await page.getByTestId('receive-blocked').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
    await wait(2500)
    ok(await page.getByTestId('receive-blocked').count() === 0 && /Vérifier les articles reçus/.test(await page.locator('main').innerText()), 'après « Passer sur » : la réception s’ouvre, « Vérifier les articles reçus » (rien n’est validé)')
    await page.screenshot({ path: `${__dirname}/out/transfer-bastos-receive-page.png` })
    ok(!s.writes.length, `aucune écriture sur les transferts (${s.writes.length})`, s.writes)
    await s.browser.close()
  }

  console.log('\nServeur (lignes invalides EXPRÈS : aucune réception ne peut aboutir)')
  {
    const s = await session({ width: 390, height: 844, scale: 1, locale: 'fr' })
    await s.page.goto(`${BASE}/fr/stock/transfers`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    const post = acting => s.page.request.post(`${BASE}/api/stock-transfers/receive`, { data: { transfer_id: tr.id, acting_shop_id: acting, items: [{ transfer_item_id: 'pas-un-id', quantity_received: -1 }] } })
      .then(async r => ({ status: r.status(), body: await r.json().catch(() => ({})) }))
    const fromAkwa = await post(AKWA), fromAll = await post(null), fromBastos = await post(BASTOS)
    ok(fromAkwa.status === 409 && fromAkwa.body.code === 'transfer_receive_wrong_shop' && /passez sur Marché Soleil Bastos/.test(fromAkwa.body.error || ''), `depuis Akwa : 409 « ${fromAkwa.body.error} »`, fromAkwa)
    ok(fromAll.status === 409 && fromAll.body.code === 'transfer_receive_wrong_shop', `sans boutique (« Toutes ») : 409`, fromAll)
    ok(fromBastos.status === 400 && fromBastos.body.code !== 'transfer_receive_wrong_shop', `depuis Bastos : contrôle de boutique passé, lignes invalides refusées (${fromBastos.status})`, fromBastos)
    await s.browser.close()
  }
  const { data: after } = await db.from('stock_transfers').select('status, received_at').eq('id', tr.id).single()
  ok(after.status === 'sent' && !after.received_at, `${REF} toujours en transit en base`)
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 500)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
