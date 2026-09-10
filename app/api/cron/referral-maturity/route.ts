import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'

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

    await logCronRun('referral-maturity', 'success', data)
    return NextResponse.json({ ok: true, ...data })
  } catch (err: any) {
    console.error('[cron/referral-maturity]', err)
    await logCronRun('referral-maturity', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
