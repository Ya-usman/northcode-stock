import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { generateUniqueReferralCode } from '@/lib/referrals/generate-code'
import { getOrCreateWallet } from '@/lib/referrals/wallet'
import { getReferralConfig } from '@/lib/referrals/config'

// GET /api/referrals/summary — tout ce qu'il faut pour la page
// Paramètres > Parrainage & récompenses en un seul aller-retour (code,
// portefeuille, filleuls, historique) — un mobile-first ne doit pas
// attendre une cascade de requêtes (point 25 de la demande).
export async function GET() {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const config = await getReferralConfig(admin)
    if (!config.enabled) {
      return NextResponse.json({ enabled: false })
    }

    // Code — get-or-create (activation = première visite de cette page)
    let { data: codeRow } = await admin
      .from('referral_codes').select('code, active').eq('owner_user_id', user.id).maybeSingle()
    if (!codeRow) {
      const code = await generateUniqueReferralCode(admin, (profile as any)?.full_name || '')
      const { data: created } = await admin
        .from('referral_codes').insert({ owner_user_id: user.id, code }).select('code, active').single()
      codeRow = created
    }

    const wallet = await getOrCreateWallet(admin, user.id)

    const { data: transactions } = await admin
      .from('referral_wallet_transactions')
      .select('*')
      .eq('wallet_id', wallet.id)
      .order('created_at', { ascending: false })
      .limit(30)

    const totals = (transactions || []).reduce(
      (acc: any, tx: any) => {
        if (tx.status === 'reversed') return acc
        if (tx.type === 'reward') acc.total_earned += Number(tx.amount)
        if (tx.type === 'subscription_credit') acc.total_used += Math.abs(Number(tx.amount))
        if (tx.type === 'payout' && tx.status === 'completed') acc.total_withdrawn += Math.abs(Number(tx.amount))
        return acc
      },
      { total_earned: 0, total_used: 0, total_withdrawn: 0 }
    )

    // Mes filleuls — nom de boutique + statut, pas d'infos personnelles inutiles (point 19)
    const { data: referrals } = await admin
      .from('referrals')
      .select('id, referred_user_id, status, registered_at, qualified_at')
      .eq('referrer_user_id', user.id)
      .order('registered_at', { ascending: false })
      .limit(50)

    const referredIds = (referrals || []).map((r: any) => r.referred_user_id)
    let shopByReferred: Record<string, { name: string; plan: string | null }> = {}
    if (referredIds.length > 0) {
      const [{ data: members }, { data: profiles }] = await Promise.all([
        admin.from('shop_members').select('user_id, shop_id').in('user_id', referredIds).eq('role', 'owner').eq('is_active', true),
        admin.from('profiles').select('id, plan').in('id', referredIds),
      ])
      const planByUser: Record<string, string | null> = {}
      for (const p of profiles || []) planByUser[p.id] = p.plan
      const shopIds = (members || []).map((m: any) => m.shop_id)
      const { data: shops } = shopIds.length
        ? await admin.from('shops').select('id, name').in('id', shopIds)
        : { data: [] }
      const shopById: Record<string, string> = {}
      for (const s of shops || []) shopById[s.id] = s.name
      for (const m of members || []) {
        if (!shopByReferred[m.user_id]) {
          shopByReferred[m.user_id] = { name: shopById[m.shop_id] || '—', plan: planByUser[m.user_id] || null }
        }
      }
    }

    // Récompense associée à chaque filleul (montant + date de disponibilité)
    const referralIds = (referrals || []).map((r: any) => r.id)
    const { data: rewards } = referralIds.length
      ? await admin.from('referral_rewards').select('referral_id, amount, currency, status, available_at').in('referral_id', referralIds)
      : { data: [] }
    const rewardByReferral: Record<string, any> = {}
    for (const r of rewards || []) rewardByReferral[r.referral_id] = r

    const enrichedReferrals = (referrals || []).map((r: any) => ({
      id: r.id,
      shop_name: shopByReferred[r.referred_user_id]?.name || '—',
      status: r.status,
      registered_at: r.registered_at,
      qualified_at: r.qualified_at,
      reward: rewardByReferral[r.id]
        ? {
            amount: rewardByReferral[r.id].amount,
            currency: rewardByReferral[r.id].currency,
            status: rewardByReferral[r.id].status,
            available_at: rewardByReferral[r.id].available_at,
          }
        : null,
    }))

    return NextResponse.json({
      enabled: true,
      code: codeRow?.code ?? null,
      code_active: codeRow?.active ?? true,
      wallet: {
        currency: wallet.currency,
        available_balance: Number(wallet.available_balance),
        pending_balance: Number(wallet.pending_balance),
        frozen: wallet.frozen,
        auto_apply_to_subscription: wallet.auto_apply_to_subscription,
      },
      totals,
      referrals: enrichedReferrals,
      transactions: transactions || [],
      min_payout: config.min_payout_by_currency[wallet.currency] ?? null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
