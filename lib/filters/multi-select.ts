// ── Filtres à choix multiple : règles communes ──────────────────────────────
// Pures et testées (scripts de test : jiti). Une dimension = une liste de valeurs
// choisies ; liste vide = « Toutes » = aucune restriction.
// OU à l'intérieur d'une dimension, ET entre les dimensions (chaque page combine
// ses dimensions avec matchesAny).
// Les options gardent leur VRAI identifiant : deux catégories « Alimentation » de
// deux boutiques restent deux options, jamais fusionnées par libellé.

export interface FilterOption {
  value: string
  label: string
  /** Précision affichée à droite (ex. nombre de produits) */
  hint?: string
  /** Pastille de couleur (catégories) */
  color?: string | null
}

export interface FilterGroup {
  id: string
  /** Titre du groupe (nom de la boutique) ; absent = pas de titre */
  label?: string
  options: FilterOption[]
}

export interface ShopRef { id: string; name: string }

/** Tri alphabétique selon la langue de l'interface (accents, casse, nombres) */
export function collatorFor(locale: string): Intl.Collator {
  try { return new Intl.Collator(locale, { sensitivity: 'base', numeric: true }) }
  catch { return new Intl.Collator(undefined, { sensitivity: 'base', numeric: true }) }
}

/**
 * Options d'une liste rattachée à une boutique (catégories, fournisseurs…).
 * - grouped = false (une seule boutique dans le contexte) : un seul groupe sans titre ;
 * - grouped = true (« Toutes les boutiques ») : un groupe par boutique, titré du nom
 *   de la boutique, boutiques et options triées selon la langue.
 * Aucune déduplication : chaque ligne reste une option avec son identifiant.
 */
export function shopScopedGroups<T>(
  items: T[],
  get: { id: (x: T) => string; label: (x: T) => string; shopId: (x: T) => string | null | undefined; color?: (x: T) => string | null | undefined },
  shops: ShopRef[],
  grouped: boolean,
  locale: string,
): FilterGroup[] {
  const col = collatorFor(locale)
  const toOption = (x: T): FilterOption => ({ value: get.id(x), label: get.label(x), color: get.color?.(x) ?? null })
  const byLabel = (a: FilterOption, b: FilterOption) => col.compare(a.label, b.label) || a.value.localeCompare(b.value)
  if (!grouped) return [{ id: 'all', options: items.map(toOption).sort(byLabel) }]
  const groups: FilterGroup[] = []
  const known = new Set(shops.map(s => s.id))
  for (const shop of [...shops].sort((a, b) => col.compare(a.name, b.name))) {
    const options = items.filter(x => get.shopId(x) === shop.id).map(toOption).sort(byLabel)
    if (options.length) groups.push({ id: shop.id, label: shop.name, options })
  }
  // Ligne d'une boutique absente de la liste (ne devrait pas arriver) : montrée quand même, jamais perdue
  const orphans = items.filter(x => !known.has(get.shopId(x) ?? '')).map(toOption).sort(byLabel)
  if (orphans.length) groups.push({ id: 'other', options: orphans })
  return groups
}

/**
 * Coche / décoche une valeur. Une valeur « exclusive » (ex. Archivé, qui change de
 * jeu de données) ne se combine avec aucune autre : la cocher décoche les autres,
 * cocher une autre valeur la décoche.
 */
export function toggleValue(selected: string[], value: string, exclusive: string[] = []): string[] {
  if (selected.includes(value)) return selected.filter(v => v !== value)
  if (exclusive.includes(value)) return [value]
  return [...selected.filter(v => !exclusive.includes(v)), value]
}

/** OU dans une dimension : aucune valeur choisie = tout passe */
export function matchesAny(selected: string[], test: (value: string) => boolean): boolean {
  return selected.length === 0 || selected.some(test)
}

/** Valeur mémorisée → liste de chaînes (ancien format à valeur unique ou donnée abîmée = vide) */
export function asValueList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * Retire les valeurs qui n'existent plus (catégorie supprimée, fournisseur retiré…)
 * pour qu'un filtre fantôme ne vide jamais la liste. known = null : liste pas
 * encore chargée, on ne touche à rien.
 */
export function keepKnown(selected: string[], known: Set<string> | null): string[] {
  return known ? selected.filter(v => known.has(v)) : selected
}

/** Toutes les options, groupes à plat */
export function flatOptions(groups: FilterGroup[]): FilterOption[] {
  return groups.flatMap(g => g.options)
}

/**
 * Libellé compact du déclencheur :
 * 0 → « Catégorie » ; 1 → « Alimentation » ; 2 et plus → « Catégorie · 2 »
 * (count est rendu par la traduction filters.compact).
 */
export function compactLabel(dimension: string, selected: string[], groups: FilterGroup[]): { kind: 'none' | 'one' | 'many'; text: string; count: number } {
  if (selected.length === 0) return { kind: 'none', text: dimension, count: 0 }
  if (selected.length === 1) {
    const o = flatOptions(groups).find(x => x.value === selected[0])
    return { kind: 'one', text: o?.label ?? dimension, count: 1 }
  }
  return { kind: 'many', text: dimension, count: selected.length }
}

/** Recherche sans accents ni casse */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Groupes réduits aux options dont le libellé (ou le nom de boutique) contient la recherche */
export function searchGroups(groups: FilterGroup[], query: string): FilterGroup[] {
  const q = foldText(query)
  if (!q) return groups
  return groups
    .map(g => (g.label && foldText(g.label).includes(q)) ? g : { ...g, options: g.options.filter(o => foldText(o.label).includes(q)) })
    .filter(g => g.options.length)
}

// ── Contexte de mémoire des filtres ─────────────────────────────────────────
// Une boutique choisie dans l'en-tête : son identifiant (même clé qu'avant, les
// liens qui posent des filtres pour une boutique continuent de fonctionner).
// « Toutes les boutiques » : une clé tirée de l'ensemble des boutiques du compte,
// donc propre à l'entreprise. Chaque contexte a son propre état.
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function filterScopeKey(dashboardShopFilter: string | null | undefined, shopIds: string[]): string | null {
  if (dashboardShopFilter) return dashboardShopFilter
  if (!shopIds.length) return null
  return 'all-' + hash([...shopIds].sort().join(','))
}
