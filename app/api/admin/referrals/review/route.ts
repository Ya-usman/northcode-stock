import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { notifyReferral, formatRefAmount } from '@/lib/referrals/notify'

// GET /api/admin/referrals/review — associations retenues pour revue anti-fraude.
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any

  const { data: referrals, error } = await admin
    .from('referrals')
    .select('id, referrer_user_id, referred_user_id, status, risk_flags, registered_at')
    .eq('needs_review', true)
    .order('registered_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = referrals || []
  const referrerIds = Array.from(new Set(list.map((r: any) => r.referrer_user_id)))
  const referredIds = Array.from(new Set(list.map((r: any) => r.referred_user_id)))
  const referralIds = list.map((r: any) => r.id)

  const [{ data: profiles }, { data: codes }, { data: members }, { data: rewards }] = await Promise.all([
    admin.from('profiles').select('id, full_name').in('id', [...referrerIds, ...referredIds]),
    admin.from('referral_codes').select('owner_user_id, code').in('owner_user_id', referrerIds),
    referredIds.length
      ? admin.from('shop_members').select('user_id, shop_id').in('user_id', referredIds).eq('role', 'owner').eq('is_active', true)
      : Promise.resolve({ data: [] }),
    referralIds.length
      ? admin.from('referral_rewards').select('referral_id, amount, currency, status').in('referral_id', referralIds)
      : Promise.resolve({ data: [] }),
  ])

  const shopIds = (members || []).map((m: any) => m.shop_id)
  const { data: shops } = shopIds.length
    ? await admin.from('shops').select('id, name').in('id', shopIds)
    : { data: [] }

  const nameById: Record<string, string | null> = {}
  for (const p of profiles || []) nameById[p.id] = p.full_name
  const codeByUser: Record<string, string> = {}
  for (const c of codes || []) codeByUser[c.owner_user_id] = c.code
  const shopNameById: Record<string, string> = {}
  for (const s of shops || []) shopNameById[s.id] = s.name
  const shopByUser: Record<string, string> = {}
  for (const m of members || []) if (!shopByUser[m.user_id]) shopByUser[m.user_id] = shopNameById[m.shop_id] || '—'
  const rewardByReferral: Record<string, any> = {}
  for (const rw of rewards || []) rewardByReferral[rw.referral_id] = rw

  // Emails via auth.users
  const emailById: Record<string, string | null> = {}
  await Promise.all([...referrerIds, ...referredIds].map(async (id: any) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id)
      emailById[id] = data.user?.email || null
    } catch { emailById[id] = null }
  }))

  return NextResponse.json({
    referrals: list.map((r: any) => ({
      id: r.id,
      status: r.status,
      registered_at: r.registered_at,
      risk_flags: Array.isArray(r.risk_flags) ? r.risk_flags : [],
      referrer: { user_id: r.referrer_user_id, full_name: nameById[r.referrer_user_id] || null, email: emailById[r.referrer_user_id] || null, code: codeByUser[r.referrer_user_id] || null },
      referred: { user_id: r.referred_user_id, full_name: nameById[r.referred_user_id] || null, email: emailById[r.referred_user_id] || null, shop_name: shopByUser[r.referred_user_id] || '—' },
      reward: rewardByReferral[r.id]
        ? { amount: Number(rewardByReferral[r.id].amount), currency: rewardByReferral[r.id].currency, status: rewardByReferral[r.id].status }
        : null,
    })),
  })
}

// POST /api/admin/referrals/review — approuve ou rejette une association (super_admin).
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  try {
    const { referral_id, decision } = await request.json()
    if (!referral_id || !['approve', 'reject'].includes(decision)) {
      return NextResponse.json({ error: 'referral_id et decision (approve|reject) requis' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Récompense concernée (avant décision) — pour notifier le parrain si rejet.
    const { data: reward } = await admin
      .from('referral_rewards').select('referrer_user_id, amount, currency, status')
      .eq('referral_id', referral_id).order('created_at', { ascending: true }).limit(1).maybeSingle()

    const { data, error } = await admin.rpc('review_referral', {
      p_referral_id: referral_id, p_decision: decision, p_reviewer_id: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.ok) return NextResponse.json({ error: data?.reason || 'Action impossible' }, { status: 400 })

    await writeAuditLog({
      action: 'referral.reviewed', actor_id: user.id, actor_email: user.email,
      target_id: referral_id, target_type: 'referral',
      metadata: { decision, reward_reversed: !!data.reward_reversed }, ip: getClientIp(request),
    })

    if (decision === 'reject' && data.reward_reversed && reward?.referrer_user_id && ['pending', 'available'].includes(reward.status)) {
      await notifyReferral(admin, {
        userId: reward.referrer_user_id,
        event: 'reward_cancelled',
        vars: { amount: formatRefAmount(reward.amount, reward.currency) },
      })
    }

    return NextResponse.json({ success: true, decision })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
