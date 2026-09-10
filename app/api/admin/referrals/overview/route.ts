import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

// GET /api/admin/referrals/overview — statistiques du programme de parrainage.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any

  const [
    { count: activeCodes },
    { data: referrals },
    { data: rewards },
    { data: txns },
    { data: payouts },
  ] = await Promise.all([
    admin.from('referral_codes').select('id', { count: 'exact', head: true }).eq('active', true),
    admin.from('referrals').select('status, first_paid_subscription_id'),
    admin.from('referral_rewards').select('amount, status'),
    admin.from('referral_wallet_transactions').select('type, amount, status'),
    admin.from('referral_payout_requests').select('amount, status'),
  ])

  const refs = referrals || []
  const converted = refs.filter((r: any) => !!r.first_paid_subscription_id).length
  const totalRefs = refs.length

  // Revenu réel généré : montant des souscriptions "premier paiement" des filleuls
  const firstSubIds = refs.map((r: any) => r.first_paid_subscription_id).filter(Boolean)
  let revenueGenerated = 0
  if (firstSubIds.length > 0) {
    const { data: subs } = await admin.from('subscriptions').select('amount').in('id', firstSubIds)
    revenueGenerated = (subs || []).reduce((s: number, x: any) => s + Number(x.amount), 0)
  }

  const totalRewards = (rewards || [])
    .filter((r: any) => r.status !== 'reversed' && r.status !== 'rejected')
    .reduce((s: number, r: any) => s + Number(r.amount), 0)

  const totalUsed = (txns || [])
    .filter((t: any) => t.type === 'subscription_credit' && t.status === 'completed')
    .reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0)

  const totalWithdrawn = (payouts || [])
    .filter((p: any) => p.status === 'paid')
    .reduce((s: number, p: any) => s + Number(p.amount), 0)

  const byStatus: Record<string, number> = {}
  for (const r of refs) byStatus[r.status] = (byStatus[r.status] || 0) + 1

  return NextResponse.json({
    active_codes: activeCodes ?? 0,
    total_referrals: totalRefs,
    converted,
    conversion_rate: totalRefs > 0 ? Math.round((converted / totalRefs) * 100) : 0,
    referrals_by_status: byStatus,
    total_rewards: totalRewards,
    total_used: totalUsed,
    total_withdrawn: totalWithdrawn,
    revenue_generated: revenueGenerated,
    pending_payouts: (payouts || []).filter((p: any) => ['requested', 'under_review', 'approved'].includes(p.status)).length,
  })
}
