import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { COUNTRIES } from '@/lib/saas/countries'
import { resolvePricingCountry, priceZone, ACTIVITY_WINDOW_DAYS } from '@/lib/saas/pricing-country'

// « Écarts de pays » (migration 208, 3 nov. 2026) : entreprises dont le pays déclaré, l'activité réelle et les paiements
// ne concordent pas, et pays de tarification fixé à la main. GET : support et super_admin ; POST / DELETE : super_admin
// seul, motif obligatoire, journalisé (admin.pricing_country_set / admin.pricing_country_clear).

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const admin = await createAdminClient() as any
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const [{ data: ents }, { data: act }, { data: reviews }] = await Promise.all([
    admin.from('entities').select('id, name, plan, billing_country, country, pricing_country, pricing_country_reason, pricing_country_set_at, is_internal'),
    admin.from('entity_activity_countries').select('entity_id, country, ops, logins').gte('day', since),
    admin.from('audit_logs').select('shop_id, metadata, created_at').eq('action', 'billing.country_review').order('created_at', { ascending: false }).limit(200),
  ])
  const byEntity = new Map<string, { country: string; ops: number; logins: number }[]>()
  for (const r of act || []) {
    const list = byEntity.get(r.entity_id) || []
    const same = list.find(x => x.country === r.country)
    if (same) { same.ops += r.ops; same.logins += r.logins } else list.push({ country: r.country, ops: r.ops, logins: r.logins })
    byEntity.set(r.entity_id, list)
  }
  const shopEntity = new Map<string, string>()
  const reviewShops = Array.from(new Set((reviews || []).map((r: any) => r.shop_id).filter(Boolean)))
  if (reviewShops.length) {
    const { data: shops } = await admin.from('shops').select('id, entity_id').in('id', reviewShops)
    for (const s of shops || []) shopEntity.set(s.id, s.entity_id)
  }
  const reviewsBy = new Map<string, any[]>()
  for (const r of reviews || []) {
    const e = shopEntity.get(r.shop_id); if (!e) continue
    reviewsBy.set(e, [...(reviewsBy.get(e) || []), { at: r.created_at, ...r.metadata }])
  }
  const rows = (ents || []).map((e: any) => {
    const activity = (byEntity.get(e.id) || []).sort((a, b) => b.ops - a.ops)
    const declared = e.billing_country || e.country || 'NG'
    const p = resolvePricingCountry({ declared, override: e.pricing_country, activity })
    const gap = !!e.pricing_country || p.reason === 'activity' || (reviewsBy.get(e.id) || []).length > 0
      || (p.activityCountry !== null && p.activityCountry !== declared)
    return {
      id: e.id, name: e.name, plan: e.plan, internal: !!e.is_internal, declared, pricing_country: p.country, reason: p.reason,
      override: e.pricing_country ? { country: e.pricing_country, reason: e.pricing_country_reason, at: e.pricing_country_set_at } : null,
      activity, activity_country: p.activityCountry, activity_share: Math.round(p.activityShare * 100), activity_ops: p.activityOps,
      zones: { declared: priceZone(declared), activity: p.activityCountry ? priceZone(p.activityCountry) : null },
      reviews: (reviewsBy.get(e.id) || []).slice(0, 5), gap,
    }
  })
  return NextResponse.json({ rows: rows.filter((r: any) => r.gap), total: rows.length, window_days: ACTIVITY_WINDOW_DAYS })
}

// POST { entity_id, country, reason } : fixe le pays de tarification
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const country = String(body?.country || '').toUpperCase()
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!body?.entity_id || !(country in COUNTRIES)) return NextResponse.json({ error: 'Pays inconnu' }, { status: 400 })
  if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
  const admin = await createAdminClient() as any
  const { data: before } = await admin.from('entities').select('id, name, pricing_country').eq('id', body.entity_id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
  const { error } = await admin.from('entities').update({ pricing_country: country, pricing_country_reason: reason, pricing_country_set_at: new Date().toISOString() }).eq('id', body.entity_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await writeAuditLog({ action: 'admin.pricing_country_set', actor_id: auth.user.id, target_id: body.entity_id, target_type: 'entity',
    metadata: { entity: before.name, from: before.pricing_country, to: country, reason }, ip: getClientIp(request) } as any)
  return NextResponse.json({ ok: true })
}

// DELETE { entity_id, reason } : retour à la règle automatique
export async function DELETE(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (!body?.entity_id) return NextResponse.json({ error: 'Entreprise manquante' }, { status: 400 })
  if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
  const admin = await createAdminClient() as any
  const { data: before } = await admin.from('entities').select('id, name, pricing_country').eq('id', body.entity_id).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
  const { error } = await admin.from('entities').update({ pricing_country: null, pricing_country_reason: null, pricing_country_set_at: null }).eq('id', body.entity_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await writeAuditLog({ action: 'admin.pricing_country_clear', actor_id: auth.user.id, target_id: body.entity_id, target_type: 'entity',
    metadata: { entity: before.name, from: before.pricing_country, reason }, ip: getClientIp(request) } as any)
  return NextResponse.json({ ok: true })
}
