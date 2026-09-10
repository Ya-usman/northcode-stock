import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

// GET /api/admin/referrals/lookup?q=CODE — résout un code de parrainage et
// renvoie tout : propriétaire, filleuls, portefeuille, récompenses, retraits.
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ error: 'Recherche vide' }, { status: 400 })

  const admin = await createAdminClient() as any

  // Recherche par code (exact, insensible à la casse) ou par email
  let ownerUserId: string | null = null
  let codeRow: any = null

  const { data: byCode } = await admin
    .from('referral_codes').select('*').ilike('code', q).maybeSingle()
  if (byCode) {
    codeRow = byCode
    ownerUserId = byCode.owner_user_id
  } else if (q.includes('@')) {
    // Résolution par email via auth.users
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const u = (list?.users || []).find((x: any) => (x.email || '').toLowerCase() === q.toLowerCase())
    if (u) {
      ownerUserId = u.id
      const { data: c } = await admin.from('referral_codes').select('*').eq('owner_user_id', u.id).maybeSingle()
      codeRow = c
    }
  }

  if (!ownerUserId) {
    return NextResponse.json({ found: false })
  }

  const [{ data: profile }, { data: authUser }, { data: wallet }, { data: referrals }, { data: payouts }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', ownerUserId).maybeSingle(),
    admin.auth.admin.getUserById(ownerUserId),
    admin.from('referral_wallets').select('*').eq('user_id', ownerUserId).maybeSingle(),
    admin.from('referrals').select('id, referred_user_id, status, registered_at, qualified_at, first_paid_subscription_id')
      .eq('referrer_user_id', ownerUserId).order('registered_at', { ascending: false }),
    admin.from('referral_payout_requests').select('id, amount, currency, method, status, created_at, paid_at')
      .eq('user_id', ownerUserId).order('created_at', { ascending: false }).limit(20),
  ])

  const referralIds = (referrals || []).map((r: any) => r.id)
  const referredIds = (referrals || []).map((r: any) => r.referred_user_id)

  const [{ data: rewards }, { data: members }] = await Promise.all([
    referralIds.length
      ? admin.from('referral_rewards').select('id, referral_id, amount, currency, status, available_at, created_at').in('referral_id', referralIds)
      : Promise.resolve({ data: [] }),
    referredIds.length
      ? admin.from('shop_members').select('user_id, shop_id').in('user_id', referredIds).eq('role', 'owner').eq('is_active', true)
      : Promise.resolve({ data: [] }),
  ])

  const shopIds = (members || []).map((m: any) => m.shop_id)
  const { data: shops } = shopIds.length
    ? await admin.from('shops').select('id, name').in('id', shopIds)
    : { data: [] }
  const shopById: Record<string, string> = {}
  for (const s of shops || []) shopById[s.id] = s.name
  const shopByUser: Record<string, string> = {}
  for (const m of members || []) if (!shopByUser[m.user_id]) shopByUser[m.user_id] = shopById[m.shop_id] || '—'
  const rewardByReferral: Record<string, any> = {}
  for (const rw of rewards || []) rewardByReferral[rw.referral_id] = rw

  return NextResponse.json({
    found: true,
    owner: {
      user_id: ownerUserId,
      full_name: profile?.full_name || null,
      email: authUser?.user?.email || null,
    },
    code: codeRow ? { id: codeRow.id, code: codeRow.code, active: codeRow.active } : null,
    wallet: wallet
      ? {
          id: wallet.id, currency: wallet.currency, frozen: wallet.frozen,
          available_balance: Number(wallet.available_balance), pending_balance: Number(wallet.pending_balance),
        }
      : null,
    referrals: (referrals || []).map((r: any) => ({
      id: r.id,
      shop_name: shopByUser[r.referred_user_id] || '—',
      status: r.status,
      registered_at: r.registered_at,
      qualified_at: r.qualified_at,
      reward: rewardByReferral[r.id]
        ? { id: rewardByReferral[r.id].id, amount: rewardByReferral[r.id].amount, currency: rewardByReferral[r.id].currency, status: rewardByReferral[r.id].status }
        : null,
    })),
    payouts: payouts || [],
  })
}
