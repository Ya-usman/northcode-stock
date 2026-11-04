import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { CLEAR_NEXT } from '@/lib/saas/plan-change'
import { getEntityAddons, MAX_ADDON_SEATS } from '@/lib/saas/addons'
import { clearCustomPlan } from '@/lib/saas/custom-plan-server'
import { enforceShopPlanLimits } from '@/lib/saas/enforce-limits'

// Remboursement d'un paiement fait PAR ERREUR (règle du 4 nov. 2026 : pas de remboursement, sauf erreur signalée sous
// 48 h ; le remboursement lui-même se fait chez la passerelle). Super_admin seul ; motif obligatoire ; journalisé.
//   GET                         → paiements confirmés des 7 derniers jours (pour choisir)
//   POST { reference, reason, late? } → paiement « remboursé » et situation d'AVANT remise :
//        formule / options : formule, fin de période et fin d'essai d'avant le paiement (gardées au paiement,
//        migration 212), changement programmé retiré ; option : quantités retirées ; devis : offre sur mesure retirée.
//        Au-delà de 48 h : refus, sauf `late: true` (décision explicite de l'administrateur).

export async function GET() {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const admin = await createAdminClient() as any
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data } = await admin.from('payment_intents')
    .select('reference, kind, plan, billing_period, currency, amount_due, paid_amount, gateway, status, settled_at, schedule, prev_plan, addon_seats, addon_shops, entity_id, entities(name)')
    .in('status', ['paid', 'refunded']).gte('settled_at', since).order('settled_at', { ascending: false }).limit(50)
  return NextResponse.json({ payments: (data || []).map((p: any) => ({ ...p, entity_name: p.entities?.name ?? '', entities: undefined })) })
}

export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const reason = String(body?.reason || '').trim()
  if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
  const admin = await createAdminClient() as any
  const { data: pi } = await admin.from('payment_intents').select('*').eq('reference', String(body?.reference || '')).maybeSingle()
  if (!pi) return NextResponse.json({ error: 'Paiement introuvable' }, { status: 404 })
  if (pi.status !== 'paid') return NextResponse.json({ error: 'Seul un paiement confirmé peut être remboursé' }, { status: 409 })
  const hours = (Date.now() - new Date(pi.settled_at).getTime()) / 3_600_000
  if (hours > 48 && body?.late !== true) return NextResponse.json({ error: `Paiement confirmé il y a ${Math.round(hours)} h (règle : 48 h). Confirmez pour rembourser quand même.`, code: 'late' }, { status: 409 })
  // Formule : la situation d'avant n'est juste que si aucun paiement de formule n'a suivi (sinon il serait effacé)
  if (pi.kind !== 'addon') {
    const { data: later } = await admin.from('payment_intents').select('reference').eq('entity_id', pi.entity_id).eq('status', 'paid')
      .in('kind', ['plan', 'custom']).gt('settled_at', pi.settled_at).limit(1)
    if (later?.length) return NextResponse.json({ error: `Un paiement plus récent existe (${later[0].reference}) : remboursez d'abord celui-là.` }, { status: 409 })
  }

  // Paiement marqué remboursé d'abord (écriture conditionnée : une seule fois)
  const now = new Date().toISOString()
  const { data: done } = await admin.from('payment_intents').update({ status: 'refunded', refunded_at: now, refund_reason: reason }).eq('id', pi.id).eq('status', 'paid').select('id')
  if (!done?.length) return NextResponse.json({ error: 'Le paiement a changé entre-temps, rechargez' }, { status: 409 })

  let restored: string
  if (pi.kind === 'addon') {
    const cur = await getEntityAddons(admin, pi.entity_id)
    await admin.from('entities').update({
      addon_seats: Math.max(0, cur.seats - Number(pi.addon_seats || 0)), addon_shops: Math.max(0, cur.shops - Number(pi.addon_shops || 0)),
      addon_seats_renew: cur.seatsRenew === null ? null : Math.max(0, Math.min(MAX_ADDON_SEATS, cur.seatsRenew - Number(pi.addon_seats || 0))),
      addon_shops_renew: cur.shopsRenew === null ? null : Math.max(0, cur.shopsRenew - Number(pi.addon_shops || 0)),
    }).eq('id', pi.entity_id)
    restored = 'options retirées'
  } else if (pi.prev_plan || pi.prev_plan_expires_at || pi.prev_trial_ends_at) {
    await admin.from('entities').update({
      plan: pi.prev_plan || 'trial', plan_expires_at: pi.prev_plan_expires_at, trial_ends_at: pi.prev_trial_ends_at, ...CLEAR_NEXT, updated_at: now,
    }).eq('id', pi.entity_id)
    if (pi.kind === 'custom') {
      await clearCustomPlan(admin, pi.entity_id)
      if (pi.quote_id) await admin.from('custom_quotes').update({ status: 'cancelled', updated_at: now }).eq('id', pi.quote_id).eq('payment_reference', pi.reference)
    }
    restored = `formule d'avant remise (${pi.prev_plan || 'essai'})`
  } else {
    // Paiement confirmé avant la migration 212 : situation d'avant inconnue, à corriger à la main
    restored = 'situation d\'avant inconnue : corriger la formule à la main'
  }
  await admin.from('subscriptions').update({ status: 'cancelled' }).eq('paystack_reference', pi.reference)
  await writeAuditLog({
    action: 'admin.payment_refund', shop_id: pi.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: pi.reference, target_type: `${pi.gateway}_payment`,
    metadata: { reason, kind: pi.kind, plan: pi.plan, amount: pi.paid_amount ?? pi.amount_due, currency: pi.currency, hours: Math.round(hours), restored },
    ip: getClientIp(request),
  })
  enforceShopPlanLimits(admin, pi.shop_id).catch(() => {})
  return NextResponse.json({ ok: true, restored })
}
