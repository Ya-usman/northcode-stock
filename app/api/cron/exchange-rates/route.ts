import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { refreshExchangeRates } from '@/lib/saas/exchange-service'

// Rafraîchit quotidiennement les taux de change utilisés par le reporting
// consolidé (KPI du programme de parrainage). Le dashboard lit toujours la
// base — jamais l'API directement. Les overrides manuels sont préservés.
//
// Fallback : si tous les fournisseurs échouent, les derniers taux valides
// restent en base ; l'UI affiche leur date et un badge de fraîcheur.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient() as any
    const result = await refreshExchangeRates(admin)

    // Purge de l'historique (garde 120 j + toujours la ligne courante).
    if (result.updated > 0) {
      try { await admin.rpc('prune_exchange_rates') } catch { /* non bloquant */ }
    }

    const status = result.updated > 0 ? 'success' : 'error'
    await logCronRun(
      'exchange-rates',
      status,
      result,
      result.errors.length ? result.errors.join(' ; ') : undefined,
    )
    return NextResponse.json({ ok: result.updated > 0, ...result })
  } catch (err: any) {
    console.error('[cron/exchange-rates]', err)
    await logCronRun('exchange-rates', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
