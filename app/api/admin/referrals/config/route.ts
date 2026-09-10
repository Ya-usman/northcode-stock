import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getReferralConfig } from '@/lib/referrals/config'
import { PLANS } from '@/lib/saas/plans'
import { COUNTRIES } from '@/lib/saas/countries'
import { SUPPORTED_CURRENCIES, SUPPORTED_CURRENCY_SYMBOLS } from '@/lib/saas/currencies'

const CONFIG_ROW_ID = '00000000-0000-0000-0000-000000000001'
const PAID_PLAN_IDS = ['starter', 'pro', 'business'] as const
const COUNTRY_CODES = Object.keys(COUNTRIES)

// ── Validation serveur — le frontend n'est jamais cru sur parole ─────────
const patchSchema = z.object({
  enabled: z.boolean(),
  reward_percentage: z.number().min(0.5, 'Pourcentage trop bas').max(100, 'Pourcentage > 100 impossible'),
  validation_days: z.number().int().min(0, 'Délai négatif impossible').max(365, 'Délai > 365 j'),
  association_window_days: z.number().int().min(0, 'Fenêtre négative impossible').max(365, 'Fenêtre > 365 j'),
  max_referrals_per_day: z.number().int().min(1, 'Minimum 1').max(1000, 'Maximum 1000'),
  fraud_auto_hold: z.boolean(),
  eligible_plans: z.array(z.enum(PAID_PLAN_IDS)).min(1, 'Au moins un plan éligible'),
  eligible_countries: z.array(z.string()).nullable(),
  min_payout_by_currency: z.record(z.string(), z.number().min(0, 'Montant négatif impossible')),
})

function normalizeCountries(input: string[] | null): { value: string[] | null; error?: string } {
  if (input === null) return { value: null }
  const unknown = input.filter((c) => !COUNTRY_CODES.includes(c))
  if (unknown.length) return { value: null, error: `Pays inconnu(s) : ${unknown.join(', ')}` }
  if (input.length === 0) return { value: null, error: 'Sélectionnez au moins un pays, ou activez « tous les pays »' }
  if (input.length === COUNTRY_CODES.length) return { value: null } // tous cochés = null (tous éligibles)
  return { value: Array.from(new Set(input)) }
}

function validateMinPayout(input: Record<string, number>): { value: Record<string, number>; error?: string } {
  const out: Record<string, number> = {}
  for (const [sym, amount] of Object.entries(input)) {
    if (!sym.trim()) return { value: {}, error: 'Une devise est vide' }
    if (!SUPPORTED_CURRENCY_SYMBOLS.includes(sym)) return { value: {}, error: `Devise non supportée : « ${sym} »` }
    if (!Number.isFinite(amount) || amount < 0) return { value: {}, error: `Montant invalide pour ${sym}` }
    out[sym] = Math.round(amount * 100) / 100
  }
  if (Object.keys(out).length === 0) return { value: {}, error: 'Renseignez au moins un minimum de retrait' }
  return { value: out }
}

// ── GET — config actuelle + catalogues (lecture : tout admin) ────────────
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any
  const config = await getReferralConfig(admin)
  const { data: row } = await admin
    .from('referral_program_config').select('updated_at').eq('id', CONFIG_ROW_ID).maybeSingle()

  return NextResponse.json({
    config,
    updated_at: row?.updated_at ?? null,
    catalog: {
      plans: PAID_PLAN_IDS.map((id) => ({ id, name: PLANS[id].name })),
      countries: COUNTRY_CODES.map((code) => ({ code, name: COUNTRIES[code as keyof typeof COUNTRIES].name, flag: COUNTRIES[code as keyof typeof COUNTRIES].flag })),
      currencies: SUPPORTED_CURRENCIES,
    },
  })
}

// ── PATCH — enregistre la config (écriture : super_admin uniquement) ─────
export async function PATCH(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors[0]?.message || 'Données invalides' }, { status: 400 })
  }
  const p = parsed.data

  const countries = normalizeCountries(p.eligible_countries)
  if (countries.error) return NextResponse.json({ error: countries.error }, { status: 400 })

  const minPayout = validateMinPayout(p.min_payout_by_currency)
  if (minPayout.error) return NextResponse.json({ error: minPayout.error }, { status: 400 })

  const next = {
    enabled: p.enabled,
    reward_percentage: Math.round(p.reward_percentage * 100) / 100,
    validation_days: p.validation_days,
    association_window_days: p.association_window_days,
    max_referrals_per_day: p.max_referrals_per_day,
    fraud_auto_hold: p.fraud_auto_hold,
    eligible_plans: Array.from(new Set(p.eligible_plans)),
    eligible_countries: countries.value,
    min_payout_by_currency: minPayout.value,
  }

  const admin = await createAdminClient() as any

  // Valeurs actuelles (pour le diff journalisé)
  const { data: current, error: readErr } = await admin
    .from('referral_program_config')
    .select('enabled, reward_percentage, validation_days, association_window_days, max_referrals_per_day, fraud_auto_hold, eligible_plans, eligible_countries, min_payout_by_currency')
    .eq('id', CONFIG_ROW_ID)
    .maybeSingle()
  if (readErr || !current) return NextResponse.json({ error: 'Configuration introuvable' }, { status: 500 })

  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const norm = (v: unknown) => (typeof v === 'string' && !isNaN(Number(v)) ? Number(v) : v)
  const changes: Array<{ field: string; from: unknown; to: unknown }> = []
  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    const from = norm(current[key])
    const to = next[key]
    if (!eq(from, to)) changes.push({ field: key, from, to })
  }

  if (changes.length === 0) {
    return NextResponse.json({ success: true, changed: 0, config: await getReferralConfig(admin) })
  }

  const { error: updErr } = await admin
    .from('referral_program_config').update({ ...next, updated_at: new Date().toISOString() }).eq('id', CONFIG_ROW_ID)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  await writeAuditLog({
    action: 'referral.config_updated',
    actor_id: user.id,
    actor_email: user.email,
    target_id: CONFIG_ROW_ID,
    target_type: 'referral_program_config',
    metadata: { changes },
    ip: getClientIp(request),
  })

  return NextResponse.json({ success: true, changed: changes.length, config: await getReferralConfig(admin) })
}
