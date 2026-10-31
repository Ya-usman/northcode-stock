// Envoi des bons de commande par e-mail (31 oct. 2026) : fenêtre « Envoyer », journal, transferts sans assistant e-mail.
// LECTURE SEULE, serveur local, compte vitrine Marché Soleil (Akwa) :
//  - l'e-mail d'un fournisseur est INJECTÉ dans la réponse affichée (la vitrine n'en a pas) ;
//  - l'envoi (POST /api/purchase-orders/email) est SIMULÉ ici : aucun e-mail ne part ;
//  - contrôles serveur : uniquement des requêtes refusées AVANT tout envoi (bon reçu, fournisseur sans e-mail).
// Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/po-email-ux.js
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
process.env.CAPTURE_EMAIL = 'ghislainx123@gmail.com'
process.env.PIN_SHOP = '7313d74e-43dd-4b36-a59e-17ba370d29a1' // Marché Soleil Akwa
const { session, BASE } = require('./lib/capture.js')
const OUT = __dirname + '/out'
const AKWA = '7313d74e-43dd-4b36-a59e-17ba370d29a1'
const FAKE = 'fournisseur.test@example.com'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

async function openPoTab(page, locale) {
  await page.goto(`${BASE}/${locale}/suppliers`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByTestId('suppliers-tabs').waitFor({ timeout: 60000 }); await wait(1500)
  await page.getByTestId('suppliers-tabs').locator('button').nth(2).click(); await wait(2500)
}
const card = (page, ref) => page.locator(`xpath=//*[normalize-space(text())='${ref}']/ancestor::*[.//*[@data-testid='po-send']][1]`)

;(async () => {
  for (const locale of ['fr', 'en']) {
    console.log(`\n${locale}`)
    const s = await session({ width: 390, height: 844, scale: 2, locale })
    const page = s.page
    const errors = []; page.on('pageerror', e => errors.push(e.message.slice(0, 120)))
    const sent = []
    // Bons : e-mail fictif sur le fournisseur du brouillon BC-2026-0004 (réponse modifiée à l'affichage seulement)
    await page.route(/\/api\/purchase-orders\?/, async r => {
      if (r.request().method() !== 'GET') return r.fallback()
      const res = await r.fetch(); const json = await res.json()
      for (const po of json.data || []) if (po.reference === 'BC-2026-0004' && po.suppliers) po.suppliers.email = FAKE
      return r.fulfill({ response: res, json })
    })
    await page.route('**/api/purchase-orders/email**', r => {
      if (r.request().method() === 'POST') { sent.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, recipient: FAKE, status_changed: true }) }) }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
        { id: 'm1', recipient: FAKE, status: 'sent', created_at: new Date(Date.now() - 3600_000).toISOString(), sent_by_name: 'Aïcha Ndiaye' },
        { id: 'm2', recipient: FAKE, status: 'failed', created_at: new Date(Date.now() - 7200_000).toISOString(), sent_by_name: 'Aïcha Ndiaye' },
      ] }) })
    })
    await openPoTab(page, locale)

    // Brouillon avec e-mail fournisseur
    await card(page, 'BC-2026-0004').getByTestId('po-send').click(); await wait(800)
    const dlg = page.getByTestId('po-send-dialog')
    await dlg.waitFor({ timeout: 10000 })
    ok((await dlg.getByTestId('po-email-to').innerText()).includes(FAKE), 'destinataire = e-mail du fournisseur')
    ok((await dlg.getByTestId('po-email-reply-to').innerText()).includes('ghislainx123@gmail.com'), 'boutique sans e-mail : réponse à l’e-mail de l’expéditeur (décision A)')
    ok(await dlg.getByTestId('po-email-copy').isChecked(), '« M’envoyer une copie » cochée par défaut')
    const body = await dlg.getByTestId('po-email-body').inputValue()
    ok(locale === 'fr' ? /^Bonjour Papeterie Centrale,/.test(body) && body.includes('Produits commandés :') : /^Hello Papeterie Centrale,/.test(body) && body.includes('Products ordered:'), `message dans la langue (${locale})`)
    ok(!/[—–]/.test(body) && !/[—–]/.test(await dlg.locator('input').first().inputValue()), 'aucun tiret long dans l’objet ni le message')
    ok(locale === 'en' ? !/Bonjour|Produits|Cordialement/.test(body) : true, 'aucun reste de français en anglais')
    const marks = await dlg.innerText()
    ok(marks.includes(locale === 'fr' ? 'passera au statut « Envoyé »' : 'will be marked “Sent”'), 'brouillon : annonce du passage à « Envoyé » (décision B)')
    await page.screenshot({ path: `${OUT}/po-email-${locale}.png` })
    await dlg.getByTestId('po-email-copy').uncheck()
    await dlg.getByTestId('po-send-email').click(); await wait(1500)
    ok(sent.length === 1 && sent[0].shop_id === AKWA && sent[0].locale === locale && sent[0].copy === false && !('to' in sent[0]) && !('email' in sent[0]),
      `envoi : bon, boutique, langue, copie décochée, aucune adresse envoyée par le navigateur (${JSON.stringify(sent[0] || {})})`)
    ok(await page.getByTestId('po-send-dialog').count() === 0, 'fenêtre fermée après l’envoi')
    ok(await page.getByText(locale === 'fr' ? `Bon envoyé à ${FAKE}` : `Order sent to ${FAKE}`).first().isVisible().catch(() => false), 'confirmation affichée')

    // Bon envoyé, fournisseur sans e-mail : bouton désactivé, message
    await card(page, 'BC-2026-0005').getByTestId('po-send').click(); await wait(800)
    ok(await page.getByTestId('po-email-missing').isVisible(), 'fournisseur sans e-mail : message')
    ok(await page.getByTestId('po-send-email').isDisabled(), 'fournisseur sans e-mail : envoi désactivé')
    ok(await page.getByTestId('po-send-whatsapp').isEnabled(), 'WhatsApp toujours disponible')
    await page.keyboard.press('Escape'); await wait(600)

    // Bon partiellement reçu : plus d'envoi par e-mail, copie et WhatsApp restent
    await card(page, 'BC-2026-0002').getByTestId('po-send').click(); await wait(800)
    ok(await page.getByTestId('po-send-email').count() === 0 && await page.getByTestId('po-email-panel').count() === 0, 'bon reçu en partie : pas d’envoi par e-mail')
    ok(await page.getByTestId('po-send-whatsapp').isVisible(), 'bon reçu en partie : WhatsApp disponible')
    await page.keyboard.press('Escape'); await wait(600)

    // Journal : envois e-mail affichés
    await card(page, 'BC-2026-0004').locator('button[title]').first().click(); await wait(1500)
    const journal = await page.locator('[role="dialog"]').last().innerText()
    ok(journal.includes(locale === 'fr' ? `Envoyé par e-mail à ${FAKE}` : `Emailed to ${FAKE}`), 'journal : envoi réussi')
    ok(journal.includes(locale === 'fr' ? `Échec de l’envoi par e-mail à ${FAKE}` : `Email to ${FAKE} failed`), 'journal : envoi échoué')
    await page.keyboard.press('Escape'); await wait(500)

    ok(sent.length === 1, `un seul envoi simulé (${sent.length})`)
    ok(errors.length === 0, `aucune erreur JavaScript${errors.length ? ' : ' + errors.join(' | ') : ''}`)

    if (locale === 'fr') {
      // Serveur : refus AVANT tout envoi (aucun e-mail ne peut partir : bons sans e-mail fournisseur ou déjà reçus)
      const ids = await page.evaluate(async shop => {
        const r = await fetch(`/api/purchase-orders?shop_id=${shop}`); const j = await r.json()
        const by = ref => (j.data || []).find(p => p.reference === ref)
        return { draft: by('BC-2026-0004'), partial: by('BC-2026-0002') }
      }, AKWA)
      const post = async body => { const r = await s.ctx.request.post(`${BASE}/api/purchase-orders/email`, { data: body }); return { status: r.status(), json: await r.json().catch(() => ({})) } }
      const r1 = await post({ id: ids.partial.id, shop_id: AKWA, locale: 'fr', copy: false })
      ok(r1.status === 409 && /brouillon ou envoyé/.test(r1.json.error || ''), `serveur : bon reçu en partie refusé (${r1.status} ${r1.json.error})`)
      const r2 = await post({ id: ids.draft.id, shop_id: AKWA, locale: 'fr', copy: false, to: 'pirate@example.com', email: 'pirate@example.com' })
      ok(r2.status === 400 && /adresse e-mail valide/.test(r2.json.error || ''), `serveur : adresse fournie par le navigateur ignorée, fournisseur sans e-mail refusé (${r2.status} ${r2.json.error})`)
      const r3 = await post({ id: ids.draft.id, shop_id: 'abec3e3f-3e92-4ff0-a374-d2d88f57899b', locale: 'fr' })
      ok(r3.status === 404 || r3.status === 403, `serveur : bon d’une autre boutique refusé (${r3.status})`)
      const r4 = await s.ctx.request.get(`${BASE}/api/purchase-orders/email?id=${ids.draft.id}&shop_id=${AKWA}`)
      ok(r4.status() !== 500, `historique : réponse propre (${r4.status()})`)

      // Transferts : plus d'assistant e-mail dans le menu
      await page.goto(`${BASE}/fr/stock/transfers`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(6000)
      await page.getByRole('button', { name: /Plus d'actions/ }).first().click(); await wait(600)
      const items = await page.getByRole('menuitem').allInnerTexts()
      ok(items.length > 0 && !items.some(x => /e-?mail/i.test(x)), `transferts : menu sans « Email » (${items.join(' / ')})`)
      ok(items.some(x => /WhatsApp/.test(x)) && items.some(x => /Partager/.test(x)), 'transferts : WhatsApp et Partager conservés')
    }
    await s.browser.close()
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 600)); console.log(`\n${pass} réussis, ${fail} échec(s), interrompu`); process.exit(1) })
