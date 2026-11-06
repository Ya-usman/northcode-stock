// Captures des pages publiques (accueil, plateforme…) prises sur le COMPTE DE DÉMONSTRATION vivant, en LECTURE SEULE
// (toute écriture bloquée par lib/capture). Relançable à tout moment : les visuels suivent l'application.
// Sortie : public/landing/*.webp (WebP léger, largeur adaptée à l'affichage).
// Usage : CAPTURE_BASE=http://localhost:3011 CAPTURE_TZ=Africa/Douala node tests/e2e/landing-captures.js
// (en ligne : CAPTURE_BASE=https://stockshop.tech CAPTURE_PROD_READONLY=1, même résultat)
const path = require('path')
const fs = require('fs')
const ROOT = path.resolve(__dirname, '../..')
const sharp = require(path.join(ROOT, 'node_modules/sharp'))
const { session, BASE } = require('./lib/capture.js')
const OUT = path.join(ROOT, 'public/landing')
const EMAIL = 'stocshopci+demo@gmail.com'
const wait = ms => new Promise(r => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

// Bandeau « Recevoir les notifications » et guide « Bien démarrer » : hors sujet sur une capture, masqués (rien n'est enregistré)
const hideNoise = async p => {
  await p.addStyleTag({ content: '[data-testid="enable-notifications-card"],[data-testid="getting-started"]{display:none!important}' }).catch(() => {})
}
const save = async (png, name, width) => {
  const out = path.join(OUT, name)
  await sharp(png).resize({ width }).webp({ quality: 82 }).toFile(out)
  const kb = Math.round(fs.statSync(out).size / 1024)
  console.log(`  ${name} : ${width} px, ${kb} Ko`)
  return kb
}

;(async () => {
  const errors = []
  // 1. Ordinateur : Rapports, toutes les boutiques, mois dernier (mois complet)
  delete process.env.PIN_SHOP
  let s = await session({ width: 1440, height: 900, scale: 4 / 3, email: EMAIL })
  let p = s.page
  p.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  // Marge : demandée en POST de lecture (/api/reports/margin), laissée passer comme dans les tests
  await p.route(/\/api\/reports\/margin$/, r => r.continue())
  await p.goto(`${BASE}/fr/reports`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(10000)
  await p.locator('main button[role="combobox"]').first().click(); await wait(500)
  await p.getByRole('option', { name: 'Mois dernier', exact: true }).click(); await wait(9000)
  await hideNoise(p); await wait(600)
  await save(await p.screenshot(), 'pc-reports.webp', 1600)
  // Tableau de bord (page Plateforme, pilotage)
  await p.goto(`${BASE}/fr/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(14000)
  await hideNoise(p); await wait(600)
  await save(await p.screenshot(), 'pc-dashboard.webp', 1600)
  await s.browser.close()

  // 2. Boutique Akwa de la démo : stock (ordinateur), caisse et crédits (téléphone)
  process.env.PIN_SHOP = '78e6e774-730f-48d5-8aed-b0cc9c1a4ce8'
  s = await session({ width: 1440, height: 900, scale: 4 / 3, email: EMAIL })
  p = s.page
  p.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await p.goto(`${BASE}/fr/stock`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(12000)
  await hideNoise(p); await wait(600)
  await save(await p.screenshot(), 'pc-stock.webp', 1600)
  await s.browser.close()
  s = await session({ width: 390, height: 844, scale: 2, email: EMAIL, mobile: true })
  p = s.page
  p.on('pageerror', e => errors.push(e.message.slice(0, 160)))
  await p.goto(`${BASE}/fr/sales/new`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(12000)
  await hideNoise(p); await wait(600)
  await save(await p.screenshot(), 'tel-pos.webp', 540)
  await p.goto(`${BASE}/fr/payments`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(10000)
  await hideNoise(p); await wait(600)
  await save(await p.screenshot(), 'tel-credits.webp', 540)
  await s.browser.close()

  console.log(errors.length ? `erreurs JS : ${errors.join(' | ')}` : 'aucune erreur JS')
  process.exit(errors.length ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
