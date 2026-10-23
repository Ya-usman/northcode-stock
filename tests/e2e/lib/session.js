// Compatibilité avec l'ancien helper « lib-session » (suites Stock) : même API openPage(), mais construite sur
// lib/capture.js, donc avec ses protections permanentes (CAPTURE_BASE obligatoire, écritures du navigateur bloquées,
// service worker toujours bloqué). L'ancien helper ne bloquait aucune écriture : il n'est plus utilisé.
//   skipGoto   : ne pas ouvrir la caisse (le test navigue lui-même)
//   beforeGoto : async (page) => …, appelé avant la première navigation
const { session, BASE, OUT } = require('./capture.js')

async function openPage({ width, height, email, path = '/fr/sales/new', skipGoto = false, beforeGoto } = {}) {
  const mobile = width < 500
  const s = await session({ width, height, scale: mobile ? 2 : 1, email, mobile })
  if (beforeGoto) await beforeGoto(s.page)
  if (skipGoto) return s
  await s.page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 90000 })
  // Caisse : grille de produits, ou « Dans quelle boutique vendez-vous ? » si l'en-tête est sur « Toutes »
  if (path === '/fr/sales/new') await s.page.waitForSelector('div.grid > div[role="button"], [data-testid="pos-pick-shop"]', { timeout: 90000 })
  await s.page.waitForTimeout(3000)
  return s
}

// SCR : dossier des captures (les anciens tests y écrivaient leurs images)
module.exports = { openPage, BASE, SCR: OUT }
