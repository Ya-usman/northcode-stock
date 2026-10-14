// ── Contexte boutique au démarrage ───────────────────────────────────────────
// Règle unique, déterministe (jamais la première boutique renvoyée par la base, l'ordre d'un tableau ou
// l'ordre alphabétique) :
// - une seule boutique accessible → cette boutique ;
// - plusieurs boutiques : la sélection explicite mémorisée si la personne y a TOUJOURS accès ; sinon
//   (aucune, « Toutes », ou boutique devenue inaccessible) → « Toutes les boutiques » (filter = null),
//   repli sûr : une action qui exige une boutique passe par requireOneShop().
//
// La « boutique active » interne (encore lue par les écrans pas encore adoptés) ne décide JAMAIS du
// contexte affiché. Elle suit : la boutique de l'en-tête ; sinon la dernière boutique choisie
// explicitement ; sinon la boutique de rattachement du profil ; sinon la plus ancienne boutique créée
// (règle explicite, pas un ordre de tableau).

export interface ShopRefForContext { id: string; created_at?: string | null }

export const ALL_SHOPS = 'all'

export function resolveShopContext({ shops, savedFilter, savedActive, profileShopId }: {
  shops: ShopRefForContext[]
  /** Sélection mémorisée de l'en-tête : un identifiant, « all », ou null (aucune) */
  savedFilter: string | null
  savedActive: string | null
  profileShopId?: string | null
}): { filter: string | null; active: string | null } {
  const ids = new Set(shops.map(s => s.id))
  if (shops.length === 0) return { filter: null, active: null }
  if (shops.length === 1) return { filter: shops[0].id, active: shops[0].id }
  const filter = savedFilter && savedFilter !== ALL_SHOPS && ids.has(savedFilter) ? savedFilter : null
  const oldest = [...shops].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id))[0]
  const active = filter
    ?? (savedActive && ids.has(savedActive) ? savedActive : null)
    ?? (profileShopId && ids.has(profileShopId) ? profileShopId : null)
    ?? oldest.id
  return { filter, active }
}

// ── Mémorisation PAR UTILISATEUR ─────────────────────────────────────────────
// Clés propres au compte : un changement de compte sur le même appareil ne réutilise jamais le contexte
// du précédent. Les anciennes clés communes (« dashboard_shop_filter », « active_shop_id ») ne servent
// qu'UNE fois, comme migration — et seulement si la boutique est accessible au compte courant
// (validation dans resolveShopContext) — puis sont effacées.
const LEGACY = { filter: 'dashboard_shop_filter', active: 'active_shop_id' } as const
const key = (userId: string, name: 'filter' | 'active') => `shop_ctx_${name}:${userId}`

export function readShopSelection(userId: string, name: 'filter' | 'active'): string | null {
  if (typeof window === 'undefined') return null
  try {
    const legacy = localStorage.getItem(LEGACY[name])
    if (legacy !== null) {
      localStorage.removeItem(LEGACY[name])
      localStorage.setItem(key(userId, name), legacy)
      return legacy
    }
    return localStorage.getItem(key(userId, name))
  } catch { return null }
}

export function writeShopSelection(userId: string | null | undefined, name: 'filter' | 'active', value: string | null): void {
  if (!userId || typeof window === 'undefined') return
  try {
    if (value === null) localStorage.removeItem(key(userId, name))
    else localStorage.setItem(key(userId, name), value)
  } catch {}
}
