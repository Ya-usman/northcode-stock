import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { getHistoricalRatesRaw } from '@/lib/saas/exchange-service'
import { SUPPORTED_CURRENCY_CODES } from '@/lib/saas/currencies'

// GET /api/admin/exchange-rates/historical?from=YYYY-MM-DD&to=YYYY-MM-DD&currencies=NGN,XAF
//
// UN SEUL appel, quelle que soit la taille de la plage ou le nombre de
// transactions à résoudre ensuite — jamais un appel par transaction. Le
// client construit un HistoricalRateIndex (lib/saas/exchange.ts) à partir
// des lignes renvoyées et résout chaque transaction en mémoire (voir
// lib/hooks/use-historical-exchange-rates.ts).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Borne raisonnable : au-delà, l'appelant devrait plutôt paginer/scoper —
// évite qu'une page mal formée ne redemande des années d'historique.
const MAX_RANGE_DAYS = 800

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const currenciesParam = searchParams.get('currencies')

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'Paramètres from/to invalides (attendu YYYY-MM-DD)' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'from doit être ≤ to' }, { status: 400 })
  }
  const rangeDays = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json({ error: `Plage trop large (${Math.round(rangeDays)} j, max ${MAX_RANGE_DAYS})` }, { status: 400 })
  }

  const currencies = currenciesParam
    ? currenciesParam.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)
    : undefined
  if (currencies?.some((c) => !SUPPORTED_CURRENCY_CODES.includes(c))) {
    return NextResponse.json({ error: 'Devise non supportée dans "currencies"' }, { status: 400 })
  }

  const admin = await createAdminClient() as any
  const rows = await getHistoricalRatesRaw(admin, { from, to, currencies })

  return NextResponse.json({ from, to, rows })
}
