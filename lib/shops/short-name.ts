// ── Nom court d'une boutique ─────────────────────────────────────────────────
// « Marché Soleil Akwa » (entreprise « Marché Soleil ») → « Akwa », pour les endroits étroits
// (en-tête du téléphone, pastille de contexte, listes en « Toutes les boutiques », transferts).
// Ordre (31 oct. 2026, migration 191) :
//   1. le nom court CHOISI par le propriétaire (shops.short_name), s'il existe ;
//   2. sinon la règle STRICTE et déterministe : le nom de la boutique commence EXACTEMENT par le nom de
//      l'entreprise (sans tenir compte des majuscules ni des accents), immédiatement suivi d'un séparateur
//      (espace, tiret, point médian, barre, deux-points, virgule) ; ce début est retiré.
//      « Dépôt Marché Soleil » reste « Dépôt Marché Soleil », « Marché Soleilx » reste « Marché Soleilx ».
//      Jamais de suppression approximative (includes / replace). Ce qui reste doit contenir une lettre :
//      « yahaya & zainab 2 » ne devient pas « 2 » (trop vague seul), le nom complet est gardé ;
//   3. sinon le nom complet.

const SEPARATOR = /^[\s\-–—·|/:,]/
const SEPARATORS = /^[\s\-–—·|/:,]+/

/** Minuscules sans accents, caractère pour caractère (même longueur que le texte d'origine composé) */
const fold = (s: string) => s.normalize('NFC').split('').map(c => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() || c).join('')

export function shortShopName(shopName: string | null | undefined, businessName: string | null | undefined, chosen?: string | null): string {
  const custom = (chosen ?? '').trim()
  if (custom) return custom
  const name = (shopName ?? '').trim().normalize('NFC')
  const business = (businessName ?? '').trim().normalize('NFC')
  if (!name || !business || name.length <= business.length) return name
  if (!fold(name).startsWith(fold(business))) return name
  const rest = name.slice(business.length)
  if (!SEPARATOR.test(rest)) return name
  const short = rest.replace(SEPARATORS, '').trim()
  // « contient une lettre » : le texte change entre minuscules et majuscules (cible ES5 du projet)
  return short && short.toLowerCase() !== short.toUpperCase() ? short : name
}

/** Nom court d'un objet boutique (champs facultatifs : avant la migration 191, short_name n'existe pas) */
export function shopShortLabel(shop: { name?: string | null; short_name?: string | null; entity_name?: string | null } | null | undefined): string {
  if (!shop) return ''
  return shortShopName(shop.name, shop.entity_name, shop.short_name)
}
