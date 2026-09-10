import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { currencyCodeForCountry } from '@/lib/saas/currencies'

type ByCurrency = Record<string, number>

function addByCurrency(acc: ByCurrency, currency: string | null | undefined, amount: number) {
  const c = currency || 'NGN'
  acc[c] = (acc[c] || 0) + amount
}

// GET /api/admin/referrals/overview — statistiques du programme de parrainage.
//
// ⚠️ Les montants financiers sont TOUJOURS ventilés par devise (code ISO) —
// jamais additionnés entre devises, jamais convertis (V1). Les compteurs
// (codes, filleuls, conversion, nb de retraits en attente) restent scalaires.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any

  const [
    { count: activeCodes },
    { data: referrals },
    { data: rewards },
    { data: wallets },
    { data: txns },
    { data: payouts },
  ] = await Promise.all([
    admin.from('referral_codes').select('id', { count: 'exact', head: true }).eq('active', true),
    admin.from('referrals').select('status, first_paid_subscription_id'),
    admin.from('referral_rewards').select('amount, currency, status'),
    admin.from('referral_wallets').select('currency, available_balance, pending_balance'),
    admin.from('referral_wallet_transactions').select('type, amount, currency, status'),
    admin.from('referral_payout_requests').select('amount, currency, status'),
  ])

  const refs = referrals || []
  const converted = refs.filter((r: any) => !!r.first_paid_subscription_id).length
  const totalRefs = refs.length

  // Revenu réel généré : montant des 1ers paiements des filleuls, par devise
  // (dérivée du pays de la boutique — subscriptions n'a pas de colonne currency).
  const firstSubIds = refs.map((r: any) => r.first_paid_subscription_id).filter(Boolean)
  const revenueGenerated: ByCurrency = {}
  if (firstSubIds.length > 0) {
    const { data: subs } = await admin.from('subscriptions').select('amount, shop_id').in('id', firstSubIds)
    const shopIds = Array.from(new Set((subs || []).map((s: any) => s.shop_id).filter(Boolean)))
    const { data: shops } = shopIds.length
      ? await admin.from('shops').select('id, country').in('id', shopIds)
      : { data: [] }
    const countryByShop: Record<string, string> = {}
    for (const s of shops || []) countryByShop[s.id] = s.country
    for (const sub of subs || []) {
      addByCurrency(revenueGenerated, currencyCodeForCountry(countryByShop[sub.shop_id]), Number(sub.amount) || 0)
    }
  }

  // Récompenses accordées (hors annulées) — vue "cumul programme"
  const rewardsTotal: ByCurrency = {}
  for (const r of rewards || []) {
    if (r.status === 'reversed' || r.status === 'rejected') continue
    addByCurrency(rewardsTotal, r.currency, Number(r.amount) || 0)
  }

  // Disponible / en attente : soldes RÉELS des portefeuilles (tiennent compte
  // des crédits déjà dépensés et des retraits) — plus juste que la somme des
  // récompenses.
  const rewardsAvailable: ByCurrency = {}
  const rewardsPending: ByCurrency = {}
  for (const w of wallets || []) {
    addByCurrency(rewardsAvailable, w.currency, Number(w.available_balance) || 0)
    addByCurrency(rewardsPending, w.currency, Number(w.pending_balance) || 0)
  }

  // Crédit utilisé sur les abonnements
  const creditUsed: ByCurrency = {}
  for (const t of txns || []) {
    if (t.type !== 'subscription_credit' || t.status !== 'completed') continue
    addByCurrency(creditUsed, t.currency, Math.abs(Number(t.amount) || 0))
  }

  // Total effectivement retiré (payé)
  const withdrawn: ByCurrency = {}
  for (const p of payouts || []) {
    if (p.status !== 'paid') continue
    addByCurrency(withdrawn, p.currency, Number(p.amount) || 0)
  }

  const byStatus: Record<string, number> = {}
  for (const r of refs) byStatus[r.status] = (byStatus[r.status] || 0) + 1

  return NextResponse.json({
    active_codes: activeCodes ?? 0,
    total_referrals: totalRefs,
    converted,
    conversion_rate: totalRefs > 0 ? Math.round((converted / totalRefs) * 100) : 0,
    referrals_by_status: byStatus,
    pending_payouts: (payouts || []).filter((p: any) => ['requested', 'under_review', 'approved'].includes(p.status)).length,
    // montants — toujours par devise
    rewards_total: rewardsTotal,
    rewards_available: rewardsAvailable,
    rewards_pending: rewardsPending,
    credit_used: creditUsed,
    withdrawn,
    revenue_generated: revenueGenerated,
  })
}
