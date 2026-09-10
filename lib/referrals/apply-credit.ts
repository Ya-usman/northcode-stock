import { writeAuditLog } from '@/lib/api/audit'
import { notifyReferral, formatRefAmount } from '@/lib/referrals/notify'

/**
 * Prévisualise l'application du crédit de parrainage à un montant donné —
 * PURE, ne modifie rien. Utilisée à l'initiation du paiement
 * (app/api/billing/subscribe) pour savoir combien facturer réellement à la
 * passerelle (ou si on peut la sauter entièrement).
 *
 * `currency` est un code ISO (celui du montant facturé). Aucun crédit si la
 * devise du portefeuille du parrain diffère — pas de conversion en V1.
 */
export async function previewWalletCredit(
  admin: any,
  userId: string,
  price: number,
  currency: string
): Promise<{ creditApplied: number; amountDue: number }> {
  const { data: wallet } = await admin
    .from('referral_wallets').select('available_balance, currency, frozen').eq('user_id', userId).maybeSingle()

  if (!wallet || wallet.frozen || wallet.currency !== currency || Number(wallet.available_balance) <= 0) {
    return { creditApplied: 0, amountDue: price }
  }

  const creditApplied = Math.min(Number(wallet.available_balance), price)
  const amountDue = Math.round((price - creditApplied) * 100) / 100
  return { creditApplied, amountDue }
}

/**
 * Débite réellement le crédit — appelée uniquement après confirmation du
 * paiement (ou immédiatement si le crédit couvre 100% du prix, auquel cas
 * aucune passerelle n'est jamais appelée). Toute la sécurité (re-vérification
 * du solde, idempotence) vit dans la fonction Postgres debit_referral_wallet_credit
 * (migration 129) — jamais bloquant pour l'activation du plan.
 */
export async function applyWalletCredit(
  admin: any,
  params: { userId: string; intendedAmount: number; currency: string; subscriptionId: string }
): Promise<void> {
  if (params.intendedAmount <= 0) return
  try {
    const { data, error } = await admin.rpc('debit_referral_wallet_credit', {
      p_user_id: params.userId,
      p_intended_amount: params.intendedAmount,
      p_currency: params.currency,
      p_subscription_id: params.subscriptionId,
    })
    if (error) {
      console.error('[applyWalletCredit]', error.message)
      return
    }
    if (Number(data?.debited) > 0) {
      await writeAuditLog({
        action: 'referral.credit_applied',
        actor_id: params.userId,
        target_id: params.subscriptionId,
        target_type: 'subscription',
        metadata: { amount: data.debited, currency: params.currency },
      })
      await notifyReferral(admin, {
        userId: params.userId,
        event: 'reward_used',
        vars: { amount: formatRefAmount(data.debited, params.currency) },
      })
    }
  } catch (err: any) {
    console.error('[applyWalletCredit] unexpected', err.message)
  }
}
