import { getOwnerShopIds } from '@/lib/api/shop-auth'

/**
 * Récupère (ou crée) le portefeuille de parrainage d'un utilisateur.
 * Devise figée à la création, résolue depuis sa propre boutique — cohérent
 * avec le fait que le wallet du parrain doit correspondre à la devise dans
 * laquelle il est lui-même facturé (voir migration 127, point 4 de la
 * demande). Utilisé quand un wallet doit exister AVANT toute récompense
 * (ex: première visite de Paramètres > Parrainage) — le chemin déclenché
 * par un paiement confirmé crée le sien directement dans la fonction SQL
 * create_referral_reward (migration 128).
 */
export async function getOrCreateWallet(admin: any, userId: string) {
  const { data: existing } = await admin.from('referral_wallets').select('*').eq('user_id', userId).maybeSingle()
  if (existing) return existing

  const shopIds = await getOwnerShopIds(admin, userId)
  let currency = '₦'
  if (shopIds.length > 0) {
    const { data: shop } = await admin.from('shops').select('currency').in('id', shopIds).limit(1).maybeSingle()
    currency = shop?.currency || '₦'
  }

  const { data: created, error } = await admin
    .from('referral_wallets').insert({ user_id: userId, currency }).select('*').single()
  if (error) {
    // Course possible (deux requêtes concurrentes) — relire plutôt qu'échouer.
    const { data: race } = await admin.from('referral_wallets').select('*').eq('user_id', userId).maybeSingle()
    if (race) return race
    throw error
  }
  return created
}
