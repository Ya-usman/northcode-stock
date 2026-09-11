import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { rateFreshness, PIVOT_CURRENCY } from '@/lib/saas/exchange'
import { getExchangeRates, refreshExchangeRates } from '@/lib/saas/exchange-service'
import { CURRENCY_LIST, isSupportedCurrencyCode } from '@/lib/saas/currencies'

// Taux de change pour le REPORTING agrégé (tout admin) — Command Center,
// Analytics, Facturation, Agents, Parrainage. Généraliste depuis toujours
// (route déplacée depuis /api/admin/referrals/rates, seul son 1er
// utilisateur : le module Parrainage n'était pas la seule raison d'être).

// GET /api/admin/exchange-rates — taux courants + métadonnées (tout admin).
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any
  const { pivot, rates } = await getExchangeRates(admin)

  const list = CURRENCY_LIST
    .filter((c) => c.code !== pivot)
    .map((c) => {
      const info = rates[c.code]
      return {
        code: c.code,
        symbol: c.symbol,
        label: c.label,
        rate: info?.rate ?? null,
        provider: info?.provider ?? null,
        effective_date: info?.effective_date ?? null,
        fetched_at: info?.fetched_at ?? null,
        is_manual_override: info?.is_manual_override ?? false,
        freshness: rateFreshness(info),
      }
    })

  // `rates` : map brute (code → RateInfo) pour la conversion côté client ;
  // `currencies` : liste enrichie pour l'affichage tabulaire admin.
  return NextResponse.json({ pivot, rates, currencies: list })
}

const putSchema = z.object({
  rates: z.array(z.object({
    currency: z.string(),
    rate: z.number().positive('Le taux doit être > 0').max(100_000_000, 'Taux improbable'),
  })).min(1),
})

// PUT /api/admin/exchange-rates — définit des OVERRIDES manuels (super_admin).
// Un override prend priorité sur les taux automatiques tant qu'il est actif.
export async function PUT(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Données invalides' }, { status: 400 })
  }

  const admin = await createAdminClient() as any
  const { rates: current } = await getExchangeRates(admin)

  const changes: Array<{ currency: string; from: number | null; to: number }> = []
  const rows: any[] = []
  const asOf = new Date().toISOString()

  for (const r of parsed.data.rates) {
    const cur = r.currency.toUpperCase()
    if (cur === PIVOT_CURRENCY) continue
    if (!isSupportedCurrencyCode(cur)) {
      return NextResponse.json({ error: `Devise non supportée : ${cur}` }, { status: 400 })
    }
    const prev = current[cur]?.rate ?? null
    const next = Math.round(r.rate * 1e10) / 1e10
    // Un ré-envoi identique ne réécrit rien SAUF si ce n'était pas déjà un override.
    if (prev === next && current[cur]?.is_manual_override) continue
    changes.push({ currency: cur, from: prev, to: next })
    rows.push({
      base_currency: cur, quote_currency: PIVOT_CURRENCY, rate: next,
      as_of: asOf, source: 'manual', provider: 'manual',
      fetched_at: asOf, effective_date: asOf.slice(0, 10), is_manual_override: true,
    })
  }

  if (rows.length === 0) return NextResponse.json({ success: true, changed: 0 })

  const { error } = await admin.from('exchange_rates').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog({
    action: 'referral.rates_updated', // nom conservé (app/[locale]/(admin)/admin/audit/page.tsx le catégorise "Parrainage")
    actor_id: user.id, actor_email: user.email, target_type: 'exchange_rates',
    metadata: { action: 'manual_override', changes, as_of: asOf }, ip: getClientIp(request),
  })

  return NextResponse.json({ success: true, changed: changes.length })
}

const postSchema = z.union([
  z.object({ action: z.literal('refresh') }),
  z.object({ action: z.literal('clear_override'), currency: z.string() }),
])

// POST /api/admin/exchange-rates — actions (super_admin) :
//   { action: 'refresh' }                     → rafraîchit depuis les fournisseurs (garde les overrides)
//   { action: 'clear_override', currency }    → supprime l'override + refetch cette devise
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Action invalide' }, { status: 400 })

  const admin = await createAdminClient() as any

  if (parsed.data.action === 'refresh') {
    const result = await refreshExchangeRates(admin)
    await writeAuditLog({
      action: 'referral.rates_updated', // nom conservé (app/[locale]/(admin)/admin/audit/page.tsx le catégorise "Parrainage")
      actor_id: user.id, actor_email: user.email, target_type: 'exchange_rates',
      metadata: { action: 'refresh', ...result }, ip: getClientIp(request),
    })
    if (result.updated === 0) {
      return NextResponse.json({ error: `Aucun taux récupéré. ${result.errors.join(' ; ')}`.trim(), ...result }, { status: 502 })
    }
    return NextResponse.json({ success: true, ...result })
  }

  // clear_override
  const cur = parsed.data.currency.toUpperCase()
  if (!isSupportedCurrencyCode(cur) || cur === PIVOT_CURRENCY) {
    return NextResponse.json({ error: 'Devise invalide' }, { status: 400 })
  }
  const result = await refreshExchangeRates(admin, { onlyCurrencies: [cur], force: true })
  await writeAuditLog({
    action: 'referral.rates_updated', // nom conservé (app/[locale]/(admin)/admin/audit/page.tsx le catégorise "Parrainage")
    actor_id: user.id, actor_email: user.email, target_type: 'exchange_rates',
    metadata: { action: 'clear_override', currency: cur, ...result }, ip: getClientIp(request),
  })
  if (result.updated === 0) {
    return NextResponse.json({ error: `Impossible de récupérer un taux automatique pour ${cur}. ${result.errors.join(' ; ')}`.trim() }, { status: 502 })
  }
  return NextResponse.json({ success: true, ...result })
}
