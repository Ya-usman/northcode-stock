// Emplacement d'un produit dans la boutique (étape 10 du Stock, migration 196, 1er nov. 2026) : « Rayon 3, étagère B »,
// « Réserve »… Texte libre, facultatif, un seul par produit. Le stock n'est pas réparti entre plusieurs emplacements.

export const MAX_LOCATION_LENGTH = 60

/** Emplacement propre (espaces resserrés) ou null si vide ; undefined si trop long (à refuser) */
export function normalizeLocation(value: unknown): string | null | undefined {
  if (value == null) return null
  const s = String(value).replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > MAX_LOCATION_LENGTH ? undefined : s
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })

/** Ordre de tournée : par emplacement (« Rayon 2 » avant « Rayon 10 »), sans emplacement à la fin, puis par nom */
export function compareByLocation(a: { location?: string | null; name: string }, b: { location?: string | null; name: string }): number {
  const la = a.location || '', lb = b.location || ''
  if (!la !== !lb) return la ? -1 : 1
  return collator.compare(la, lb) || collator.compare(a.name, b.name)
}
