import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { generateUniqueReferralCode } from '@/lib/referrals/generate-code'
import { getOrCreateWallet } from '@/lib/referrals/wallet'
import { getReferralConfig } from '@/lib/referrals/config'

// GET /api/referrals/summary — tout ce qu'il faut pour la page
// Paramètres > Parrainage & récompenses en un seul aller-retour client.
// Côté serveur, les requêtes indépendantes sont groupées par Promise.all
// plutôt qu'enchaînées une par une — une page qui semblait lente n'était
// pas due à un index manquant ici, mais à ~9-10 aller-retours séquentiels
// vers la base (chacun attendant le précédent) ramenés à 4 vagues
// parallèles.
export async function GET() {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = await createAdminClient() as any

    // Vague 1 — indépendantes l'une de l'autre
    const [{ data: profile }, config] = await Promise.all([
      supabase.from('profiles').select('role, full_name').eq('id', user.id).single(),
      getReferralConfig(admin),
    ])

    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }
    if (!config.enabled) {
      return NextResponse.json({ enabled: false })
    }

    // Vague 2 — code, portefeuille et filleuls ne dépendent que de user.id,
    // aucun des trois ne dépend d'un autre.
    const [{ data: codeRow0 }, wallet, { data: referrals }] = await Promise.all([
      admin.from('referral_codes').select('code, active').eq('owner_user_id', user.id).maybeSingle(),
      getOrCreateWallet(admin, user.id),
      admin.from('referrals')
        .select('id, referred_user_id, status, registered_at, qualified_at')
        .eq('referrer_user_id', user.id)
        .order('registered_at', { ascending: false })
        .limit(50),
    ])

    // Cas rare (première visite jamais faite) — get-or-create du code,
    // hors de la vague parallèle puisqu'il dépend de son résultat.
    let codeRow = codeRow0
    if (!codeRow) {
      const code = await generateUniqueReferralCode(admin, (profile as any)?.full_name || '')
      const { data: created } = await admin
        .from('referral_codes').insert({ owner_user_id: user.id, code }).select('code, active').single()
      codeRow = created
    }

    const referredIds = (referrals || []).map((r: any) => r.referred_user_id)
    const referralIds = (referrals || []).map((r: any) => r.id)

    // Vague 3 — historique du wallet, membres+plans des filleuls, et
    // récompenses associées : aucune de ces trois ne dépend des deux autres.
    const [{ data: transactions }, [{ data: members }, { data: profiles }], { data: rewards }] = await Promise.all([
      admin.from('referral_wallet_transactions')
        .select('*').eq('wallet_id', wallet.id).order('created_at', { ascending: false }).limit(30),
      referredIds.length
        ? Promise.all([
            admin.from('shop_members').select('user_id, shop_id').in('user_id', referredIds).eq('role', 'owner').eq('is_active', true),
            admin.from('profiles').select('id, plan').in('id', referredIds),
          ])
        : Promise.resolve([{ data: [] }, { data: [] }]),
      referralIds.length
        ? admin.from('referral_rewards').select('referral_id, amount, currency, status, available_at').in('referral_id', referralIds)
        : Promise.resolve({ data: [] }),
    ])

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
    const planByUser: Record<string, string | null> = {}
    for (const p of profiles || []) planByUser[p.id] = p.plan
    const shopIds = (members || []).map((m: any) => m.shop_id)
    // Vague 4 — dépend des membres résolus en vague 3, ne peut pas être parallélisée avec elle.
    const { data: shops } = shopIds.length
      ? await admin.from('shops').select('id, name').in('id', shopIds)
      : { data: [] }
    const shopById: Record<string, string> = {}
    for (const s of shops || []) shopById[s.id] = s.name
    const shopByReferred: Record<string, { name: string; plan: string | null }> = {}
    for (const m of members || []) {
      if (!shopByReferred[m.user_id]) {
        shopByReferred[m.user_id] = { name: shopById[m.shop_id] || '—', plan: planByUser[m.user_id] || null }
      }
    }

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
