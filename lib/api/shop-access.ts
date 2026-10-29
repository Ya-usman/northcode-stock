// ── Droits d'une personne dans des boutiques, évalués côté serveur ───────────────────────────────────────────────
// Règle unique pour le tableau de bord et les rapports : le périmètre (mes ventes / toute la boutique, sections
// visibles, coûts) est décidé ICI, à partir de l'utilisateur authentifié, de son rôle DANS chaque boutique et des
// réglages de cette boutique — jamais à partir d'un paramètre envoyé par le navigateur (cashier_id, « mes ventes »…).
// Même résolution que l'interface (lib/permissions) : une boutique sans adhésion active ne donne aucun droit.

import { resolvePermission, canViewCost as canViewCostRule, type PermFeature, type StoredPermissions } from '@/lib/permissions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ShopAccess {
  shopId: string
  role: string
  /** Droit de consultation d'une fonction ou d'un widget dans CETTE boutique */
  view: (feature: PermFeature) => boolean
  /** Prix d'achat, marges, valeur d'achat du stock (règle unique canViewCost) */
  cost: boolean
}

/** Identifiants de boutiques valides (UUID), sans doublon. Renvoie null si l'un d'eux est invalide. */
export function parseShopIds(raw: unknown): string[] | null {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',')
  const ids = Array.from(new Set(list.map(x => String(x).trim()).filter(Boolean)))
  if (!ids.length || ids.some(id => !UUID.test(id))) return null
  return ids
}

/** Droits de la personne dans chacune des boutiques demandées où elle est membre active (les autres sont absentes). */
export async function loadShopAccess(supabase: any, userId: string, shopIds: string[]): Promise<ShopAccess[]> {
  if (!shopIds.length) return []
  const [{ data: members }, { data: shops }] = await Promise.all([
    supabase.from('shop_members').select('shop_id, role').in('shop_id', shopIds).eq('user_id', userId).eq('is_active', true),
    supabase.from('shops').select('id, role_permissions').in('id', shopIds),
  ])
  const stored: Record<string, StoredPermissions | null> = {}
  for (const s of (shops || []) as Array<{ id: string; role_permissions: StoredPermissions | null }>) stored[s.id] = s.role_permissions ?? null
  return ((members || []) as Array<{ shop_id: string; role: string }>).map(m => {
    const perms = stored[m.shop_id] ?? null
    return {
      shopId: m.shop_id,
      role: m.role,
      view: (feature: PermFeature) => resolvePermission(perms, m.role, feature).view,
      cost: canViewCostRule(perms, m.role),
    }
  })
}

/**
 * Garde commune des routes du tableau de bord : boutiques valides, membre active de CHACUNE (sinon 403), puis
 * seulement celles où l'un des widgets demandés est autorisé (aucune → 403) ; vendeur à filtrer décidé par boutique.
 */
export async function dashboardGuard(
  supabase: any, userId: string, rawShopIds: unknown, features: PermFeature[], requestedSeller?: string | null,
): Promise<{ error: { status: number; key: string } } | { shopIds: string[]; seller: Record<string, string | null>; access: ShopAccess[] }> {
  const ids = parseShopIds(rawShopIds)
  if (!ids) return { error: { status: 400, key: 'missing_params' } }
  const all = await loadShopAccess(supabase, userId, ids)
  if (all.length !== ids.length) return { error: { status: 403, key: 'shop_access_denied' } }
  const access = all.filter(a => features.some(f => a.view(f)))
  if (!access.length) return { error: { status: 403, key: 'permission_denied' } }
  const seller: Record<string, string | null> = {}
  for (const a of access) seller[a.shopId] = sellerFilter(a, userId, requestedSeller)
  return { shopIds: access.map(a => a.shopId), seller, access }
}

// ── Ventes visibles : DEUX règles, décision « option 1 » du 26 oct. 2026 ─────────────────────────────────────────
//   • LISTES détaillées (ventes récentes, remboursements, historique, lectures directes de la base) : caissier et
//     magasinier → TOUJOURS leurs propres ventes (ownSalesScope, même règle que la base) ;
//   • CHIFFRES agrégés (graphiques, meilleurs produits, rapports, encaissé) : caissier et magasinier → leurs propres
//     ventes, SAUF si le propriétaire leur a ouvert « Chiffre d'affaires de la boutique » (revenue_chart) →
//     toute la boutique (ownFiguresOnly / sellerFilter). Les autres rôles : toute la boutique.

/**
 * LISTES : caissier et magasinier → seulement leurs ventes ; autres rôles → toute la boutique (règles RLS
 * sales_cashier_own / sales_stock_manager_own). Renvoie l'identifiant du vendeur à filtrer (null = toute la boutique).
 */
export function ownSalesScope(access: ShopAccess, userId: string): string | null {
  return access.role === 'cashier' || access.role === 'stock_manager' ? userId : null
}

/** CHIFFRES agrégés : caissier ou magasinier sans « Chiffre d'affaires de la boutique » → ses propres ventes seulement */
export function ownFiguresOnly(access: ShopAccess): boolean {
  return (access.role === 'cashier' || access.role === 'stock_manager') && !access.view('revenue_chart')
}

/**
 * Chiffre d'affaires d'une boutique : « ses propres ventes » ou « toute la boutique » ? (CHIFFRES agrégés)
 * Caissier et magasinier ne voient que leurs ventes, sauf si le propriétaire leur a ouvert le chiffre d'affaires de
 * la boutique (« revenue_chart ») ; les autres rôles voient toute la boutique (ownFiguresOnly). Un filtre vendeur demandé par le navigateur peut
 * seulement RESTREINDRE ce périmètre, jamais l'élargir.
 * Renvoie l'identifiant du vendeur à filtrer (null = toute la boutique).
 */
export function sellerFilter(access: ShopAccess, userId: string, requested?: string | null): string | null {
  if (ownFiguresOnly(access)) return userId
  return requested && UUID.test(requested) ? requested : null
}
