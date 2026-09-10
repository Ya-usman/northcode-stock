import { getOwnerShopIds } from '@/lib/api/shop-auth'
import { currencyCodeForCountry } from '@/lib/saas/currencies'

/**
 * Récupère (ou crée) le portefeuille de parrainage d'un utilisateur.
 * Devise figée à la création (CODE ISO), résolue depuis le PAYS de sa
 * boutique PRINCIPALE (`profiles.shop_id`) — cohérent avec le fait que le
 * wallet du parrain doit correspondre à la devise dans laquelle il est
 * lui-même facturé (migration 127, point 4). On dérive de `shops.country`
 * (code stable), jamais de `shops.currency` (chaîne d'affichage). Pour un
 * propriétaire multi-boutiques, la boutique principale départage — le
 * choix est ainsi déterministe (V1 : pas de portefeuille multi-devises).
 */
export async function getOrCreateWallet(admin: any, userId: string) {
  const { data: existing } = await admin.from('referral_wallets').select('*').eq('user_id', userId).maybeSingle()
  if (existing) return existing

  let country: string | null = null
  const { data: profile } = await admin.from('profiles').select('shop_id').eq('id', userId).maybeSingle()
  if (profile?.shop_id) {
    const { data: primary } = await admin.from('shops').select('country').eq('id', profile.shop_id).maybeSingle()
    country = primary?.country ?? null
  }
  if (!country) {
    const shopIds = await getOwnerShopIds(admin, userId)
    if (shopIds.length > 0) {
      const { data: shop } = await admin.from('shops').select('country').in('id', shopIds).order('created_at', { ascending: true }).limit(1).maybeSingle()
      country = shop?.country ?? null
    }
  }
  const currency = currencyCodeForCountry(country)

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
