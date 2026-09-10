import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/admin/referrals/moderate — actions de modération (super_admin).
//   suspend_code / reactivate_code — active/désactive un code
//   freeze_wallet / unfreeze_wallet — gèle/dégèle un portefeuille
//   cancel_reward — annule une récompense frauduleuse (clawback)
//   adjust_wallet — ajustement manuel du solde (+/-), avec motif
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  try {
    const body = await request.json()
    const action = String(body?.action || '')
    const admin = await createAdminClient() as any

    switch (action) {
      case 'suspend_code':
      case 'reactivate_code': {
        const codeId = body?.code_id
        if (!codeId) return NextResponse.json({ error: 'code_id requis' }, { status: 400 })
        const active = action === 'reactivate_code'
        const { error } = await admin.from('referral_codes').update({ active }).eq('id', codeId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await writeAuditLog({
          action: 'referral.code_moderated', actor_id: user.id, actor_email: user.email,
          target_id: codeId, target_type: 'referral_code', metadata: { active }, ip: getClientIp(request),
        })
        return NextResponse.json({ success: true, active })
      }

      case 'freeze_wallet':
      case 'unfreeze_wallet': {
        const walletId = body?.wallet_id
        if (!walletId) return NextResponse.json({ error: 'wallet_id requis' }, { status: 400 })
        const frozen = action === 'freeze_wallet'
        const { error } = await admin.from('referral_wallets').update({ frozen }).eq('id', walletId)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        await writeAuditLog({
          action: 'referral.wallet_moderated', actor_id: user.id, actor_email: user.email,
          target_id: walletId, target_type: 'referral_wallet', metadata: { frozen }, ip: getClientIp(request),
        })
        return NextResponse.json({ success: true, frozen })
      }

      case 'cancel_reward': {
        const rewardId = body?.reward_id
        const reason = String(body?.reason || '').slice(0, 300)
        if (!rewardId) return NextResponse.json({ error: 'reward_id requis' }, { status: 400 })
        const { data, error } = await admin.rpc('cancel_referral_reward', {
          p_reward_id: rewardId, p_reviewer_id: user.id, p_reason: reason || null,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (!data?.ok) return NextResponse.json({ error: data?.reason || 'Action impossible' }, { status: 400 })
        await writeAuditLog({
          action: 'referral.reward_cancelled', actor_id: user.id, actor_email: user.email,
          target_id: rewardId, target_type: 'referral_reward',
          metadata: { clawed_back: data.clawed_back, reason }, ip: getClientIp(request),
        })
        return NextResponse.json({ success: true, clawed_back: data.clawed_back })
      }

      case 'adjust_wallet': {
        const userId = body?.user_id
        const amount = Number(body?.amount)
        const reason = String(body?.reason || '').slice(0, 300)
        if (!userId || !Number.isFinite(amount) || amount === 0) {
          return NextResponse.json({ error: 'user_id, amount (non nul) requis' }, { status: 400 })
        }
        if (!reason) return NextResponse.json({ error: 'Motif requis pour un ajustement' }, { status: 400 })
        const { data, error } = await admin.rpc('adjust_referral_wallet', {
          p_user_id: userId, p_amount: amount, p_reason: reason, p_reviewer_id: user.id,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        if (!data?.ok) return NextResponse.json({ error: data?.reason || 'Ajustement impossible' }, { status: 400 })
        await writeAuditLog({
          action: 'referral.wallet_adjusted', actor_id: user.id, actor_email: user.email,
          target_id: userId, target_type: 'profile',
          metadata: { applied: data.applied, reason }, ip: getClientIp(request),
        })
        return NextResponse.json({ success: true, applied: data.applied })
      }

      default:
        return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
