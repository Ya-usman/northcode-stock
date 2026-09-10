import { writeAuditLog } from '@/lib/api/audit'

/**
 * Déclenche la création d'une récompense de parrainage après un paiement
 * confirmé — appelée depuis les 4 routes de vérification de paiement
 * (Paystack/Flutterwave/NotchPay/Wave), juste après l'insertion de la
 * ligne `subscriptions`.
 *
 * Toute la logique (idempotence, réclamation atomique, mise à jour du
 * portefeuille) vit dans la fonction Postgres `create_referral_reward`
 * (migration 128) — un seul aller-retour transactionnel, jamais d'état
 * partiel. Cette fonction ne doit JAMAIS faire échouer la confirmation
 * du paiement : toute erreur est avalée et journalisée.
 */
export async function processReferralReward(
  admin: any,
  params: {
    ownerId: string
    subscriptionId: string
    shopCurrency: string
    planId: string
    amount: number
    country?: string | null
  }
): Promise<void> {
  try {
    const { data, error } = await admin.rpc('create_referral_reward', {
      p_owner_id: params.ownerId,
      p_subscription_id: params.subscriptionId,
      p_shop_currency: params.shopCurrency,
      p_plan_id: params.planId,
      p_amount: params.amount,
      p_country: params.country ?? null,
    })

    if (error) {
      console.error('[processReferralReward]', error.message)
      return
    }

    if (data?.created) {
      await writeAuditLog({
        action: 'referral.reward_created',
        actor_id: params.ownerId,
        target_id: data.reward_id,
        target_type: 'referral_reward',
        metadata: { amount: data.amount, currency: data.currency, subscription_id: params.subscriptionId },
      })
    }
    // data.created === false (disabled / not_referred / already_qualified /
    // plan_not_eligible / country_not_eligible / currency_mismatch) n'est
    // pas une erreur — cas normaux, pas besoin de journal d'audit.
  } catch (err: any) {
    console.error('[processReferralReward] unexpected', err.message)
  }
}
