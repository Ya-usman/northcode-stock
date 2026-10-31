// STOCK > PRODUITS — passe de simplification (zone du haut, cartes, menus, pluralisation, contexte de boutique).
// LECTURE SEULE : toute écriture du navigateur est bloquée ; les fenêtres ouvertes sont refermées sans rien valider.
// Boutique Alpha : propriétaire, gérant, caissier (sans le droit de voir les coûts, Stock en consultation).
// Usage : CAPTURE_BASE=http://localhost:3000 node products-ux.js
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { session, BASE } = require('./lib/capture.js')
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const OWNER = 'admin@northcode.ng', MANAGER = 'cassierstock@gmail.com', CASHIER = 'stocshopci@gmail.com'
const MSG = l => JSON.parse(fs.readFileSync(`${ROOT}/messages/${l}.json`, 'utf8'))
let ok = 0, ko = 0
const check = (label, cond, extra = '') => { cond ? ok++ : ko++; console.log(cond ? '  ok   ' : '  ÉCHEC', label, cond ? '' : '→ ' + String(extra).slice(0, 420)) }

async function open(locale, width, height, { email = OWNER, only = null, view = 'cards' } = {}) {
  process.env.CAPTURE_EMAIL = email
  const s = await session({ width, height, scale: 1, locale })
  await s.page.context().addInitScript(([id, filter, v]) => { try { localStorage.setItem('active_shop_id', id); if (filter) localStorage.setItem('dashboard_shop_filter', filter); else localStorage.removeItem('dashboard_shop_filter'); if (v) for (const k of Object.keys(localStorage)) if (/view/i.test(k) && /stock/i.test(k)) localStorage.setItem(k, v) } catch {} }, [ALPHA, only, view])
  s.shops = new Set()
  s.page.on('request', r => { const m = r.url().match(/\/rest\/v1\/products\?.*shop_id=in\.%28([^&]+)%29/); if (m) decodeURIComponent(m[1]).split(',').forEach(x => s.shops.add(x)) })
  await s.page.goto(`${BASE}/${locale}/stock/products`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await s.page.locator('[data-product-card], table').first().waitFor({ timeout: 40000 })
  await s.page.waitForTimeout(3000)
  return s
}
const cardsMode = async page => { if (!(await page.locator('[data-product-card]').count())) { await page.locator('[role="group"] button[aria-pressed]').first().click(); await page.locator('[data-product-card]').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(800) } }
const tableMode = async page => { if (!(await page.locator('table').count())) { await page.locator('[role="group"] button[aria-pressed]').nth(1).click(); await page.locator('table').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(800) } }
const toolbar = page => page.evaluate(() => {
  const q = s => document.querySelector(s), bar = q('[data-testid="products-toolbar"]')
  const y = e => (e ? Math.round(e.getBoundingClientRect().top) : null)
  const btns = [...bar.querySelectorAll('button')]
  const add = btns.find(b => /bg-stockshop-blue(\s|$)/.test(b.className) && b.getBoundingClientRect().height > 30)
  const combos = [...bar.querySelectorAll('[data-testid="filter-category"], [data-testid="filter-status"]')]
  const first = q('[data-product-card], table'), tabs = q('[role="tablist"]')
  return {
    rows: { search: y(bar.querySelector('input')), add: y(add), combos: combos.map(y), filters: y(q('[data-testid="products-more-filters"]')), more: y(q('[data-testid="products-more-actions"]')), count: y(q('[data-testid="products-count"]')), view: y(q('[role="group"] button[aria-pressed]')) },
    filled: btns.filter(b => /bg-stockshop-blue(\s|$)/.test(b.className) && b.getBoundingClientRect().height > 30).map(b => b.innerText.trim()),
    labels: combos.map(c => c.innerText.trim()), placeholder: bar.querySelector('input').placeholder,
    cut: combos.filter(c => { const sp = c.querySelector('span'); return sp && sp.scrollWidth > sp.clientWidth + 1 }).length,
    small: btns.filter(b => b.getBoundingClientRect().height < 44).map(b => (b.innerText || b.title || '').trim().slice(0, 14)),
    block: Math.round(first.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom),
    count: q('[data-testid="products-count"]').innerText.trim(),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    groups: [...document.querySelectorAll('main span.uppercase.tracking-wide')].filter(e => e.closest('.space-y-2') && /store|lucide/.test(e.previousElementSibling ? e.previousElementSibling.getAttribute('class') || '' : '')).length,
    // Texte de la barre SANS le badge de contexte (« Toutes les boutiques » : indicateur, pas un filtre)
    text: (() => { const c = bar.cloneNode(true); c.querySelectorAll('[data-testid=shop-scope-badge]').forEach(e => e.remove()); return c.textContent })(),
    shopControls: [...bar.querySelectorAll('select, button[role=combobox]')].filter(e => /boutique/i.test(e.textContent || '')).length,
  }
})
const cardInfo = (page, id) => page.evaluate(i => {
  const c = document.querySelector(`[data-product-card="${i}"]`); if (!c) return null
  const r = c.getBoundingClientRect()
  return { h: Math.round(r.height), text: c.innerText.replace(/\s+/g, ' '), sku: !!c.querySelector('p.font-mono'), cost: !!c.querySelector('[data-card-cost]'), footer: !!c.querySelector('[data-card-footer]'), buttons: [...c.querySelectorAll('button')].filter(b => b.getBoundingClientRect().height >= 40).map(b => (b.innerText || b.title || b.getAttribute('aria-label') || '').trim()), smallTap: [...c.querySelectorAll('[data-card-footer] button')].filter(b => b.getBoundingClientRect().height < 44).length, empty: [...c.querySelectorAll('p, div')].filter(e => !e.children.length && !e.innerText.trim() && e.getBoundingClientRect().height > 6).length, cursor: getComputedStyle(c).cursor }
}, id)
const sheet = page => page.locator('[data-testid="product-detail"]')
const closeAll = async page => { for (let i = 0; i < 4 && (await page.locator('[role="dialog"], [role="alertdialog"], [role="menu"]').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(450) } }

;(async () => {
  console.log('Base :', BASE)
  const { data: prods } = await admin.from('products').select('id, name, sku, quantity, buying_price, shop_id, low_stock_threshold').eq('shop_id', ALPHA).eq('is_active', true).order('name')
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
  const { data: mem } = await admin.from('shop_members').select('shop_id, shops(name)').eq('user_id', link.user.id).eq('is_active', true)
  const { count: totalAll } = await admin.from('products').select('id', { count: 'exact', head: true }).in('shop_id', mem.map(m => m.shop_id)).eq('is_active', true)
  const withSku = prods.find(p => p.sku && p.quantity > 20), noSku = prods.find(p => !p.sku && p.quantity > 20)
  console.log(`Boutique Alpha : ${prods.length} produits actifs ; ${totalAll} sur les ${mem.length} boutiques du compte`)

  // ══ 1. Téléphone, propriétaire, toutes les boutiques ══════════════════════════════════════════════════════
  console.log('\n1. Zone du haut — téléphone 390 px, propriétaire, toutes les boutiques')
  const s = await open('fr', 390, 844)
  const page = s.page
  await cardsMode(page)
  let tb = await toolbar(page)
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 14
  check('rangée 1 : la recherche et « Ajouter », côte à côte', near(tb.rows.search, tb.rows.add), JSON.stringify(tb.rows))
  check(`rangée 2 : ${tb.labels.join(', ')}, « Plus de filtres », « … »`, tb.labels.join('|') === 'Catégorie|Statut' && tb.rows.combos.every(y => near(y, tb.rows.filters)) && near(tb.rows.filters, tb.rows.more) && tb.rows.filters > tb.rows.add, JSON.stringify(tb.rows))
  check(`rangée 3 : le compteur (« ${tb.count} ») et la petite bascule cartes / liste`, near(tb.rows.count, tb.rows.view) && tb.rows.count > tb.rows.more, JSON.stringify(tb.rows))
  check(`« Ajouter » est le seul bouton plein de la barre`, tb.filled.join('|') === 'Ajouter', tb.filled.join('|'))
  // Budget relevé le 31 oct. 2026 (option A validée) : l'en-tête commun (titre « Produits », pastille, phrase) ajoute
  // ~78 px sur téléphone et ~51 px sur ordinateur. Avant l'en-tête : 230 px (téléphone) / 180 px (ordinateur).
  check(`${tb.block} px entre les onglets et le premier produit (368 px avant la simplification, 230 avant l’en-tête commun)`, tb.block <= 312, tb.block)
  check('indication de recherche courte, aucun libellé coupé, aucune petite zone tactile, pas de défilement horizontal', tb.placeholder === 'Rechercher un produit…' && tb.cut === 0 && tb.small.length === 0 && tb.overflow <= 0, JSON.stringify({ p: tb.placeholder, cut: tb.cut, small: tb.small, o: tb.overflow }))
  check(`compteur accordé : « ${tb.count} » — plus de « (s) » sur la page`, tb.count === `${totalAll} produits` && !/\(s\)/.test(await page.locator('main').innerText()), tb.count)
  check('plus de bouton « Importer / Exporter » ni de filtre Boutique dans la barre', !/Importer|Exporter|boutique/i.test(tb.text) && tb.shopControls === 0, tb.text.replace(/\s+/g, ' '))
  await page.getByRole('button', { name: /^Ajouter$/ }).click(); await page.waitForTimeout(500)
  const addItems = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  check(`menu Ajouter : ${addItems.join(' / ')}`, addItems.join('|') === 'Ajouter un produit|Ajout rapide|Importer des produits', addItems.join('|'))
  await closeAll(page)
  await page.locator('[data-testid="products-more-actions"]').click(); await page.waitForTimeout(500)
  const moreItems = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
  check(`menu « … » : ${moreItems.join(' / ')} — l’import n’y est pas (un seul endroit)`, moreItems.slice(0, 2).join('|') === 'Exporter en Excel|Exporter en CSV' && moreItems.includes('Sélectionner') && moreItems.includes('Journal d’activité') && !moreItems.some(x => /Importer/.test(x)), moreItems.join('|'))
  await closeAll(page)
  check(`toutes les boutiques : produits regroupés par boutique (${tb.groups} titres), toutes demandées à la base`, tb.groups === mem.length && s.shops.size === mem.length, `${tb.groups} / ${[...s.shops].length}`)

  // ══ 2. Carte ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n2. Carte produit — propriétaire')
  const a = await cardInfo(page, withSku.id), b = await cardInfo(page, noSku.id)
  check(`« ${withSku.name.trim()} » : ${a.h} px de haut (188 px avant) — ${a.text.slice(0, 90)}…`, a.h <= 170 && a.text.includes(withSku.name.trim()) && /En stock|Stock faible|Rupture|Ventes lentes/.test(a.text) && /F CFA|₦/.test(a.text), JSON.stringify(a))
  check('une seule action visible (« Réapprovisionner ») et le menu « … »', a.buttons.filter(x => !/Ouvrir la fiche/.test(x) && x !== withSku.name.trim()).join('|') === 'Réapprovisionner|Plus d’actions', a.buttons.join('|'))
  check('code affiché en petit quand il existe ; aucune ligne vide quand il n’existe pas', a.sku && !b.sku && a.empty === 0 && b.empty === 0, JSON.stringify({ a: a.empty, b: b.empty }))
  check('coût affiché (droit de voir les coûts) ; zones tactiles ≥ 44 px ; curseur « main »', a.cost && /Coût/.test(a.text) && a.smallTap === 0 && a.cursor === 'pointer', JSON.stringify({ c: a.cost, t: a.smallTap }))
  const card = page.locator(`[data-product-card="${withSku.id}"]`)
  await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(400)
  await card.locator('[data-card-menu]').click(); await page.waitForTimeout(500)
  const cardMenu = (await page.getByRole('menuitem').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim())
  check(`menu « … » de la carte : ${cardMenu.join(' / ')}`, ['Modifier', 'Mettre en promo', 'Voir les lots', 'Archiver le produit'].every(x => cardMenu.some(y => y.startsWith(x))) && (await sheet(page).count()) === 0, cardMenu.join('|'))
  await page.getByRole('menuitem', { name: 'Modifier' }).click(); await page.waitForTimeout(1500)
  check('… « Modifier » ouvre le panneau de modification, pas la fiche', (await sheet(page).count()) === 0 && (await page.locator('[role="dialog"] form').count()) >= 1)
  await closeAll(page)
  await card.locator('[data-card-menu]').click(); await page.waitForTimeout(400)
  await page.getByRole('menuitem', { name: /Mettre en promo/ }).click(); await page.waitForTimeout(1200)
  check('… « Mettre en promo » ouvre la fenêtre de promotion', (await sheet(page).count()) === 0 && (await page.locator('[role="dialog"]').count()) >= 1)
  await closeAll(page)
  await card.locator('[data-card-menu]').click(); await page.waitForTimeout(400)
  await page.getByRole('menuitem', { name: 'Archiver le produit' }).click(); await page.waitForTimeout(1000)
  check('… « Archiver le produit » demande confirmation (annulée, aucune écriture)', (await sheet(page).count()) === 0 && /Archiver/.test(await page.locator('[role="dialog"], [role="alertdialog"]').last().innerText()))
  await closeAll(page)
  await card.locator('[data-card-menu]').click(); await page.waitForTimeout(400)
  await page.getByRole('menuitem', { name: 'Voir les lots' }).click(); await sheet(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1200)
  check('… « Voir les lots » ouvre la fiche du produit sur ses lots', (await sheet(page).count()) === 1 && (await sheet(page).innerText()).includes(withSku.name.trim()))
  await closeAll(page)
  await card.locator('[data-card-restock]').click(); await page.waitForTimeout(1000)
  check('bouton « Réapprovisionner » : sa fenêtre seulement, pas la fiche', (await sheet(page).count()) === 0 && (await page.locator('[role="dialog"] form').count()) >= 1)
  await closeAll(page)
  // Carte entière : photo, nom, zone neutre → fiche
  for (const [where, sel] of [['la photo', 'button[aria-label^="Ouvrir la fiche"]'], ['le nom', '[data-product-name]']]) {
    await card.locator(sel).click(); const opened = await sheet(page).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
    check(`toucher ${where} ouvre la fiche du produit`, opened && (await sheet(page).innerText()).includes(withSku.name.trim()))
    await closeAll(page)
  }
  const box = await card.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + 14); const neutral = await sheet(page).waitFor({ timeout: 10000 }).then(() => true).catch(() => false)
  check('toucher une zone neutre de la carte ouvre la fiche', neutral)
  const actions = (await sheet(page).locator('[data-testid="product-detail-actions"]').innerText()).replace(/\s+/g, ' ')
  check(`les actions retirées de la carte sont dans la fiche : ${actions}`, ['Réapprovisionner', 'Modifier', 'Mettre en promo', 'Archiver'].every(x => actions.includes(x)), actions)
  await closeAll(page)

  // Suggestion de promotion : plus sur la carte ; dans le menu du produit et dans sa fiche
  console.log('\n3. Suggestion de promotion (hors de la carte, jamais perdue)')
  // Statut « Ventes lentes » : panneau du bas (téléphone) ou fenêtre (ordinateur)
  await page.getByTestId('filter-status').click()
  const stSheet = page.getByTestId('filter-status-sheet')
  if (await stSheet.waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) { await stSheet.locator('[data-filter-option="dormant"]').click(); await stSheet.locator('[data-filter-apply]').click() }
  else { await page.getByTestId('filter-status-popover').locator('[data-filter-option="dormant"]').click(); await page.keyboard.press('Escape') }
  await page.waitForTimeout(1500)
  let suggested = null
  for (const id of await page.locator('[data-product-card]').evaluateAll(els => els.slice(0, 12).map(e => e.dataset.productCard))) {
    const c = page.locator(`[data-product-card="${id}"]`)
    await c.scrollIntoViewIfNeeded(); await c.locator('[data-card-menu]').click(); await page.waitForTimeout(350)
    const has = await page.locator('[data-promo-suggested]').count()
    await closeAll(page)
    if (has) { suggested = id; break }
  }
  if (!suggested) console.log('  (aucun produit avec une promotion suggérée parmi les ventes lentes affichées)')
  else {
    const c = page.locator(`[data-product-card="${suggested}"]`)
    const info = await cardInfo(page, suggested)
    check('la carte ne porte aucun signal de suggestion (ni badge, ni bouton coloré)', !/sugg/i.test(info.text) && (await c.locator('.text-amber-600, .border-amber-300').count()) === 0, info.text)
    await c.locator('[data-card-menu]').click(); await page.waitForTimeout(350)
    check('menu du produit : « Mettre en promo » porte la mention « suggérée »', /Mettre en promo\s*suggérée/.test((await page.locator('[data-card-promo]').innerText()).replace(/\s+/g, ' ')))
    await closeAll(page)
    await c.locator('[data-product-name]').click(); await sheet(page).waitFor({ timeout: 15000 }); await page.waitForTimeout(1500)
    const banner = sheet(page).locator('[data-testid="product-detail-promo-suggestion"]')
    check(`fiche du produit : « ${(await banner.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)} »`, (await banner.count()) === 1 && /Promotion suggérée/.test(await banner.innerText()) && (await banner.getByRole('button', { name: 'Mettre en promo' }).count()) === 1)
    await page.screenshot({ path: `${__dirname}/out/produits-fiche-promo-suggeree-390.png` })
    await closeAll(page)
  }
  await page.getByRole('button', { name: 'Réinitialiser' }).click().catch(() => {}); await page.waitForTimeout(800)

  // Vue liste sur téléphone
  await tableMode(page)
  tb = await toolbar(page)
  check('vue liste : la bascule fonctionne, « Colonnes » rejoint la rangée du compteur', (await page.locator('table').count()) >= 1 && /Colonnes/.test(tb.text) && tb.overflow <= 0, tb.text.replace(/\s+/g, ' ').slice(0, 120))
  await cardsMode(page)
  await s.browser.close()

  // ══ 4. Contexte de boutique = en-tête ═════════════════════════════════════════════════════════════════════
  console.log('\n4. Contexte de boutique : le sélecteur de l’en-tête')
  const d = await open('fr', 1440, 900)
  await tableMode(d.page)
  const all0 = await toolbar(d.page)
  check(`« Toutes les boutiques » : ${all0.count}, ${await d.page.locator('table').count()} tableaux titrés`, all0.count === `${totalAll} produits` && (await d.page.locator('table').count()) === mem.length)
  d.shops.clear()
  await d.page.locator('aside button, header button').filter({ hasText: 'Toutes les boutiques' }).first().click(); await d.page.waitForTimeout(600)
  await d.page.locator('aside button, header button').filter({ hasText: /^Boutique Alpha/ }).first().click(); await d.page.waitForTimeout(4500)
  const one = await toolbar(d.page)
  const alphaNames = await d.page.locator('table tbody tr [data-product-name]').allInnerTexts()
  check(`en-tête → « Boutique Alpha » : ${one.count}, un seul tableau, sans titre de boutique, uniquement ses produits`, one.count === `${prods.length} produits` && (await d.page.locator('table').count()) === 1 && one.groups === 0 && alphaNames.length === prods.length, `${one.count} / ${alphaNames.length}`)
  check('… seule cette boutique est demandée à la base', d.shops.size === 1 && d.shops.has(ALPHA), [...d.shops].join(','))
  check('… aucun second sélecteur de boutique dans la page', one.labels.length === 2 && !/boutique/i.test(one.text))
  d.shops.clear()
  await d.page.locator('aside button, header button').filter({ hasText: /^Boutique Alpha/ }).first().click(); await d.page.waitForTimeout(600)
  await d.page.locator('aside button, header button').filter({ hasText: 'Toutes les boutiques' }).first().click(); await d.page.waitForTimeout(4500)
  const all1 = await toolbar(d.page)
  check(`en-tête → « Toutes les boutiques » : retour à ${all1.count}, regroupés par boutique`, all1.count === `${totalAll} produits` && (await d.page.locator('table').count()) === mem.length && d.shops.size === mem.length)
  check(`ordinateur : recherche, filtres, « … » et « Ajouter » sur une ligne ; ${all1.block} px avant le premier produit (201 px avant)`, near(all1.rows.search, all1.rows.add) && near(all1.rows.search, all1.rows.more) && all1.labels.join('|') === 'Catégorie|Statut' && all1.block <= 235, JSON.stringify(all1.rows))
  await d.page.screenshot({ path: `${__dirname}/out/produits-apres-1440-liste.png` })
  await d.browser.close()

  // ══ 5. Rôles ══════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n5. Rôles')
  const mg = await open('fr', 390, 844, { email: MANAGER, only: ALPHA })
  await cardsMode(mg.page)
  const mt = await toolbar(mg.page), mc = await cardInfo(mg.page, withSku.id)
  check('gérant : « Ajouter », coût sur la carte, « Réapprovisionner » et menu', mt.filled.join() === 'Ajouter' && mc.cost && mc.buttons.includes('Réapprovisionner') && mc.buttons.includes('Plus d’actions'), JSON.stringify(mc.buttons))
  await mg.browser.close()
  const ca = await open('fr', 390, 844, { email: CASHIER, only: ALPHA })
  await cardsMode(ca.page)
  const ct = await toolbar(ca.page), cc = await cardInfo(ca.page, withSku.id)
  check('caissier (Stock en consultation) : pas de « Ajouter », pas d’export ; recherche et filtres conservés', ct.filled.length === 0 && ct.labels.length === 2 && ct.rows.search != null && !/Exporter/.test(ct.text), JSON.stringify(ct.filled))
  check(`caissier : carte sans coût et sans ligne d’actions — aucun espace vide (${cc.h} px, contre ${a.h} px pour le propriétaire)`, !cc.cost && !cc.footer && !/Coût/.test(cc.text) && cc.empty === 0 && cc.h < a.h && cc.buttons.every(x => /Ouvrir la fiche/.test(x) || x === withSku.name.trim()), JSON.stringify(cc))
  await ca.page.locator(`[data-product-card="${withSku.id}"] [data-product-name]`).click(); await sheet(ca.page).waitFor({ timeout: 15000 }); await ca.page.waitForTimeout(1500)
  check('caissier : la carte ouvre toujours la fiche ; ni section Achat ni actions de modification', (await sheet(ca.page).locator('[data-testid="product-detail-purchase"]').count()) === 0 && (await sheet(ca.page).locator('[data-testid="product-detail-actions"]').count()) === 0 && (await sheet(ca.page).locator('[data-testid="product-detail-promo-suggestion"]').count()) === 0)
  await ca.page.screenshot({ path: `${__dirname}/out/produits-apres-390-caissier.png` })
  await ca.browser.close()

  // ══ 6. Langues ════════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n6. Langues (téléphone)')
  for (const locale of ['en', 'ha']) {
    const M = MSG(locale)
    const o = await open(locale, 390, 844)
    await cardsMode(o.page)
    const t = await toolbar(o.page)
    check(`${locale} : « ${t.filled.join()} », ${t.labels.join(' / ')}, « ${t.placeholder} », « ${t.count} »`, t.filled.join() === M.products.add_menu && t.labels.join('|') === `${M.products.category}|${M.products.status_label}` && t.placeholder === M.products.search_placeholder_short && t.cut === 0 && t.overflow <= 0 && !/\(s\)|[{}]|products\./.test(await o.page.locator('main').innerText()), JSON.stringify(t.labels))
    check(`${locale} : compteur accordé`, locale === 'en' ? t.count === `${totalAll} products` : t.count === `Kaya ${totalAll}`, t.count)
    await o.page.getByRole('button', { name: new RegExp('^' + M.products.add_menu + '$') }).click(); await o.page.waitForTimeout(400)
    const items = (await o.page.getByRole('menuitem').allInnerTexts()).map(x => x.trim())
    check(`${locale} : menu ${M.products.add_menu} — ${items.join(' / ')}`, items.join('|') === [M.actions.add_product, M.products.add_quick, M.products.add_import].join('|'), items.join('|'))
    await closeAll(o.page)
    const c = o.page.locator('[data-product-card]').first(); await c.locator('[data-card-menu]').click(); await o.page.waitForTimeout(400)
    const cm = (await o.page.getByRole('menuitem').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim())
    check(`${locale} : menu de la carte — ${cm.join(' / ')}`, [M.actions.edit, M.products.promo_action, M.products.view_batches, M.products.archive_label].every(x => cm.some(y => y.startsWith(x))), cm.join('|'))
    await closeAll(o.page)
    await o.page.screenshot({ path: `${__dirname}/out/produits-apres-390-${locale}.png` })
    await o.browser.close()
  }

  // ══ 7. Largeurs ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\n7. Largeurs')
  for (const [w, h, name, max] of [[360, 740, 'petit téléphone', 312], [820, 1180, 'tablette', 280], [1440, 900, 'ordinateur', 220]] /* + en-tête commun (31 oct. 2026) ; avant : 230 / 240 / 180 */) {
    for (const view of ['cards', 'table']) {
      const o = await open('fr', w, h)
      if (view === 'cards') await cardsMode(o.page); else await tableMode(o.page)
      const t = await toolbar(o.page)
      const smallCard = view === 'cards' && w < 640 ? await o.page.locator('[data-card-footer] button').evaluateAll(els => els.filter(b => b.getBoundingClientRect().height < 44).length) : 0
      check(`${name} ${w} px, ${view === 'cards' ? 'cartes' : 'liste'} : ${t.block} px avant le premier produit, sans débordement ni libellé coupé${w < 640 ? ', zones tactiles ≥ 44 px' : ''}`, t.block <= max + (view === 'table' ? 20 : 0) && t.overflow <= 0 && t.cut === 0 && (w >= 640 || (t.small.length === 0 && smallCard === 0)) && t.filled.join() === 'Ajouter', JSON.stringify({ b: t.block, o: t.overflow, cut: t.cut, small: t.small }))
      await o.page.screenshot({ path: `${__dirname}/out/produits-apres-${w}-${view === 'cards' ? 'cartes' : 'liste'}.png` })
      await o.browser.close()
    }
  }

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
