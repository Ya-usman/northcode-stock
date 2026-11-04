import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getAccountForShop } from '@/lib/saas/entity'
import { getEntityAddons } from '@/lib/saas/addons'
import { enforceShopPlanLimits } from '@/lib/saas/enforce-limits'

// Options payées d'une entreprise (migration 210), fiche boutique de l'admin. GET : support et super_admin ;
// POST : super_admin seul. Retrait d'une option REMBOURSÉE (achat par erreur, moins de 48 h, place non utilisée —
// règle du 3 nov. 2026) : le remboursement se fait chez la passerelle ; ici la quantité baisse, motif obligatoire,
// journal admin.addon_refund_remove, limites remises en ordre.

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  if (!account) return NextResponse.json({ error: 'Entreprise introuvable pour cette boutique' }, { status: 404 })
  const [addons, { data: purchases }] = await Promise.all([
    getEntityAddons(admin, account.entityId),
    admin.from('payment_intents')
      .select('reference, kind, addon_seats, addon_shops, amount_due, currency, gateway, status, created_at, settled_at, period_end, review_reason')
      .eq('entity_id', account.entityId).or('kind.eq.addon,addon_seats.gt.0,addon_shops.gt.0')
      .order('created_at', { ascending: false }).limit(20),
  ])
  return NextResponse.json({
    entity: { id: account.entityId, name: account.name, plan: account.plan, plan_expires_at: account.plan_expires_at },
    addons, purchases: purchases || [],
  })
}

// POST { shop_id, kind: 'seats' | 'shops', quantity, reason }
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const kind = body?.kind === 'shops' ? 'shops' : body?.kind === 'seats' ? 'seats' : null
  const quantity = Math.floor(Number(body?.quantity))
  const reason = String(body?.reason || '').trim()
  if (!kind) return NextResponse.json({ error: 'Type d\'option inconnu' }, { status: 400 })
  if (!(quantity >= 1 && quantity <= 20)) return NextResponse.json({ error: 'Quantité entre 1 et 20' }, { status: 400 })
  if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, String(body?.shop_id || ''))
  if (!account) return NextResponse.json({ error: 'Entreprise introuvable pour cette boutique' }, { status: 404 })
  const cur = await getEntityAddons(admin, account.entityId)
  const paid = kind === 'seats' ? cur.seats : cur.shops
  if (quantity > paid) return NextResponse.json({ error: `Seulement ${paid} payée(s)` }, { status: 400 })
  const col = kind === 'seats' ? 'addon_seats' : 'addon_shops'
  const renewCol = kind === 'seats' ? 'addon_seats_renew' : 'addon_shops_renew'
  const renew = kind === 'seats' ? cur.seatsRenew : cur.shopsRenew
  // Écriture conditionnée à la quantité lue (deux actions simultanées ne s'additionnent pas à tort)
  const { data: done } = await admin.from('entities').update({
    [col]: paid - quantity, [renewCol]: renew === null ? null : Math.max(0, Math.min(paid - quantity, renew)),
  }).eq('id', account.entityId).eq(col, paid).select('id')
  if (!done?.length) return NextResponse.json({ error: 'Les options ont changé entre-temps, rechargez' }, { status: 409 })
  await writeAuditLog({
    action: 'admin.addon_refund_remove', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email,
    target_id: account.entityId, target_type: 'entity', metadata: { kind, quantity, before: paid, after: paid - quantity, reason },
    ip: getClientIp(request),
  } as any)
  enforceShopPlanLimits(admin, body.shop_id).catch(() => {})
  return NextResponse.json({ ok: true })
}
