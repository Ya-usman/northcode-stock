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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const putSchema = z.object({
  rates: z.array(z.object({
    currency: z.string(),
    rate: z.number().positive('Le taux doit être > 0').max(100_000_000, 'Taux improbable'),
  })).min(1),
  // Date ciblée par l'override — omise = aujourd'hui (comportement historique
  // inchangé). Permet de corriger le taux d'une date PASSÉE pour le
  // reporting historique (jamais dans le futur — un taux ne se "prévoit" pas).
  effective_date: z.string().regex(DATE_RE, 'Date invalide (YYYY-MM-DD)').optional(),
  // Motif optionnel (audit/traçabilité) — migration 147.
  reason: z.string().max(500).optional(),
})

// PUT /api/admin/exchange-rates — définit des OVERRIDES manuels (super_admin).
// Un override prend priorité sur le taux automatique de LA MÊME DATE — pour
// aujourd'hui (comportement historique : bloque aussi les rafraîchissements
// automatiques tant qu'il est actif, voir refreshExchangeRates) ou pour une
// date passée (ne bloque RIEN d'autre : buildHistoricalRateIndex le fait
// déjà gagner à date égale — migrations 139/146 — sans changement de code
// nécessaire côté lecture).
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

  const asOf = new Date().toISOString()
  const today = asOf.slice(0, 10)
  const targetDate = parsed.data.effective_date ?? today
  if (targetDate > today) {
    return NextResponse.json({ error: 'Impossible de définir un taux pour une date future' }, { status: 400 })
  }
  const reason = parsed.data.reason?.trim() || null

  const admin = await createAdminClient() as any
  const currencies = Array.from(new Set(parsed.data.rates.map((r) => r.currency.toUpperCase())))
  for (const cur of currencies) {
    if (cur !== PIVOT_CURRENCY && !isSupportedCurrencyCode(cur)) {
      return NextResponse.json({ error: `Devise non supportée : ${cur}` }, { status: 400 })
    }
  }
  // Valeur précédente pour CETTE date précise (pas le taux courant si
  // targetDate est dans le passé) — n'importe quel provider, on ne compare
  // qu'à d'éventuel override déjà là ce jour-là.
  const { data: existingRows } = await admin
    .from('exchange_rates')
    .select('base_currency, rate, is_manual_override')
    .eq('quote_currency', PIVOT_CURRENCY)
    .eq('effective_date', targetDate)
    .in('base_currency', currencies.filter((c) => c !== PIVOT_CURRENCY))
  const existingByCode: Record<string, { rate: number; is_manual_override: boolean }> = {}
  for (const row of existingRows || []) {
    // Un override existant sur cette date prime pour la comparaison "déjà à jour".
    if (!existingByCode[row.base_currency] || row.is_manual_override) {
      existingByCode[row.base_currency] = { rate: Number(row.rate), is_manual_override: !!row.is_manual_override }
    }
  }

  const changes: Array<{ currency: string; from: number | null; to: number }> = []
  const rows: any[] = []

  for (const r of parsed.data.rates) {
    const cur = r.currency.toUpperCase()
    if (cur === PIVOT_CURRENCY) continue
    const prevEntry = existingByCode[cur]
    const prev = prevEntry?.rate ?? null
    const next = Math.round(r.rate * 1e10) / 1e10
    // Un ré-envoi identique ne réécrit rien SAUF si ce n'était pas déjà un override sur cette date.
    if (prev === next && prevEntry?.is_manual_override) continue
    changes.push({ currency: cur, from: prev, to: next })
    rows.push({
      base_currency: cur, quote_currency: PIVOT_CURRENCY, rate: next,
      as_of: targetDate === today ? asOf : `${targetDate}T12:00:00.000Z`,
      source: 'manual', provider: 'manual',
      fetched_at: asOf, effective_date: targetDate, is_manual_override: true,
      updated_by: user.id, override_reason: reason,
    })
  }

  if (rows.length === 0) return NextResponse.json({ success: true, changed: 0 })

  // upsert (pas insert) : un 2e override le même jour pour la même devise
  // doit mettre à jour la ligne existante, pas entrer en conflit avec la
  // contrainte (base_currency, quote_currency, effective_date, provider).
  const { error } = await admin
    .from('exchange_rates')
    .upsert(rows, { onConflict: 'base_currency,quote_currency,effective_date,provider' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog({
    action: 'referral.rates_updated', // nom conservé (app/[locale]/(admin)/admin/audit/page.tsx le catégorise "Parrainage")
    actor_id: user.id, actor_email: user.email, target_type: 'exchange_rates',
    metadata: { action: 'manual_override', changes, effective_date: targetDate, reason, as_of: asOf }, ip: getClientIp(request),
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
