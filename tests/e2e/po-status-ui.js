// Bons de commande — écran après le correctif des statuts (PATCH /api/purchase-orders). Serveur LOCAL, compte vitrine
// Marché Soleil en LECTURE SEULE : lib/capture.js bloque toute écriture ; les PATCH sont interceptés par CE test et reçoivent
// une réponse simulée (jamais envoyés au serveur). Statuts relus en base avant / après : rien ne doit changer.
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/po-status-ui.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const { session, BASE, LOCAL } = require('./lib/capture.js')
const fr = require(ROOT + '/messages/fr.json')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

;(async () => {
  if (!LOCAL) throw new Error('serveur local uniquement')
  const { data: akwa } = await db.from('shops').select('id, name').eq('id', '7313d74e-43dd-4b36-a59e-17ba370d29a1').single()
  if (akwa?.name !== 'Marché Soleil Akwa') throw new Error('boutique Akwa du compte vitrine introuvable')
  const snap = async () => ((await db.from('purchase_orders').select('reference, status, updated_at, is_opening_balance').eq('shop_id', akwa.id).order('reference')).data || [])
  const before = await snap()
  const listed = before.filter(p => !p.is_opening_balance) // reprises de dette : dans Crédits, jamais dans la liste des bons
  const byRef = Object.fromEntries(before.map(p => [p.reference, p.status]))
  console.log('Bons d’Akwa (base) :', before.map(p => `${p.reference}=${p.status}`).join(' '))
  const sentRef = before.find(p => p.status === 'sent')?.reference
  const draftRef = before.find(p => p.status === 'draft')?.reference
  if (!sentRef || !draftRef) throw new Error('il faut au moins un bon « sent » et un bon « draft » à Akwa')

  process.env.PIN_SHOP = akwa.id
  const s = await session({ width: 1366, height: 900, locale: 'fr' })
  const page = s.page; const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
  let gets = 0; page.on('request', r => { if (r.method() === 'GET' && /\/api\/purchase-orders\?/.test(r.url())) gets++ })
  let reply = null; const patches = []
  // Prioritaire sur le filet de capture.js : relit le corps et répond SANS rien envoyer au serveur
  await page.route('**/api/purchase-orders', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    patches.push(JSON.parse(route.request().postData() || '{}'))
    return route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
  })
  await page.goto(`${BASE}/fr/suppliers?view=purchase_orders`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.locator('[data-po-card]').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(2500)

  console.log('\n1. Boutons selon le statut (inchangés)')
  for (const p of before.filter(x => x.is_opening_balance))
    ok(await page.locator(`[data-po-card="${p.reference}"]`).count() === 0, `${p.reference} (reprise de dette) : absente de la liste des bons, comme avant`)
  const expand = async ref => { await page.locator(`[data-po-card="${ref}"]`).getByText(ref, { exact: true }).first().click(); await page.waitForTimeout(500) }
  for (const p of listed) {
    const card = page.locator(`[data-po-card="${p.reference}"]`)
    if (!(await card.count())) { ok(false, `${p.reference} : carte visible`); continue }
    await expand(p.reference) // « Annuler le bon » est dans la partie dépliée de la carte
    const cancel = await card.locator('button:visible', { hasText: fr.suppliers.po_cancel }).count()
    const send = await card.locator('button:visible', { hasText: fr.suppliers.po_mark_sent }).count()
    const wantCancel = p.status === 'draft' || p.status === 'sent'
    ok(cancel === (wantCancel ? 1 : 0), `${p.reference} (${p.status}) : « ${fr.suppliers.po_cancel} » ${wantCancel ? 'proposé' : 'absent'}`)
    ok(send === (p.status === 'draft' ? 1 : 0), `${p.reference} (${p.status}) : « ${fr.suppliers.po_mark_sent} » ${p.status === 'draft' ? 'proposé' : 'absent'}`)
    await expand(p.reference) // replie
  }

  console.log('\n2. Annulation refusée car le bon a changé entre-temps (409 simulé)')
  reply = { status: 409, body: { error: fr.api_errors.po_status_changed, code: 'purchase_order_status_changed' } }
  let g0 = gets
  await expand(sentRef)
  await page.locator(`[data-po-card="${sentRef}"] button:visible`, { hasText: fr.suppliers.po_cancel }).first().click()
  await page.waitForTimeout(2500)
  ok(patches.length === 1 && patches[0].status === 'cancelled' && patches[0].shop_id === akwa.id, `PATCH envoyé (intercepté) : ${sentRef} → cancelled, boutique du bon`)
  ok(await page.getByText(fr.api_errors.po_status_changed).first().isVisible().catch(() => false), `message affiché : « ${fr.api_errors.po_status_changed} »`)
  ok(gets > g0, `liste rechargée après le 409 (${gets - g0} lecture(s) /api/purchase-orders)`)

  console.log('\n3. Changement refusé « déjà réceptionné » (409 simulé) : message + rechargement')
  reply = { status: 409, body: { error: fr.api_errors.po_already_received, code: 'purchase_order_status_transition_not_allowed', reason: 'already_received' } }
  g0 = gets
  await page.locator(`[data-po-card="${draftRef}"] button:visible`, { hasText: fr.suppliers.po_mark_sent }).first().click()
  await page.waitForTimeout(2500)
  ok(patches.length === 2 && patches[1].status === 'sent', `PATCH envoyé (intercepté) : ${draftRef} → sent`)
  ok(await page.getByText(fr.api_errors.po_already_received).first().isVisible().catch(() => false), 'message « déjà réceptionné » affiché')
  ok(gets > g0, 'liste rechargée après le 409')

  console.log('\n4. Réponse normale (200 simulé) : rechargement comme avant')
  reply = { status: 200, body: { data: { id: 'x', status: 'sent' } } }
  g0 = gets
  await page.locator(`[data-po-card="${draftRef}"] button:visible`, { hasText: fr.suppliers.po_mark_sent }).first().click()
  await page.waitForTimeout(2500)
  ok(patches.length === 3 && gets > g0, 'succès : liste rechargée')
  ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)
  await s.browser.close()

  const after = await snap()
  ok(JSON.stringify(after) === JSON.stringify(before), `base inchangée : ${after.length} bons, mêmes statuts et mêmes dates de modification`)
  ok(Object.entries(byRef).every(([r, st]) => after.find(p => p.reference === r)?.status === st), 'aucun statut modifié')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 300)); process.exit(1) })
