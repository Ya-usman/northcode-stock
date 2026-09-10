import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { notifyReferral, formatRefAmount } from '@/lib/referrals/notify'

// Fait passer chaque récompense de parrainage 'pending' dont la période de
// validation (referral_program_config.validation_days) est écoulée à
// 'available' — voir mature_referral_rewards (migration 128) pour la
// logique transactionnelle complète.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('mature_referral_rewards')
    if (error) throw new Error(error.message)

    // Notifier chaque parrain dont une récompense vient de devenir disponible
    // (migration 133 : la RPC renvoie le détail des lignes mûries).
    for (const r of (data?.rewards ?? []) as Array<{ referrer_user_id: string; amount: number; currency: string }>) {
      await notifyReferral(admin, {
        userId: r.referrer_user_id,
        event: 'reward_available',
        vars: { amount: formatRefAmount(r.amount, r.currency) },
      })
    }

    await logCronRun('referral-maturity', 'success', data)
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    console.error('[cron/referral-maturity]', err)
    await logCronRun('referral-maturity', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
