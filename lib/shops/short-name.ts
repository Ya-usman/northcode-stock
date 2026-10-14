// ── Nom court d'une boutique ─────────────────────────────────────────────────
// « Marché Soleil Akwa » (entreprise « Marché Soleil ») → « Akwa », pour les endroits étroits
// (en-tête du téléphone, pastille de contexte). Règle STRICTE et déterministe :
// le nom de la boutique doit commencer EXACTEMENT par le nom de l'entreprise, immédiatement
// suivi d'un séparateur (espace, tiret, point médian, barre, deux-points, virgule). Sinon le nom
// complet est conservé : « Dépôt Marché Soleil » reste « Dépôt Marché Soleil », « Marché Soleilx »
// reste « Marché Soleilx ». Jamais de suppression approximative (includes / replace).
// Aucun champ « nom court » n'existe sur les boutiques : s'il apparaît un jour, il passera avant.

const SEPARATOR = /^[\s\-–—·|/:,]/
const SEPARATORS = /^[\s\-–—·|/:,]+/

export function shortShopName(shopName: string | null | undefined, businessName: string | null | undefined): string {
  const name = (shopName ?? '').trim()
  const business = (businessName ?? '').trim()
  if (!name || !business || name.length <= business.length) return name
  if (!name.startsWith(business)) return name
  const rest = name.slice(business.length)
  if (!SEPARATOR.test(rest)) return name
  const short = rest.replace(SEPARATORS, '').trim()
  return short || name
}
