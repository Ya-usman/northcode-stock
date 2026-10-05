import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { countTeamSeats, getShopLimit } from '@/lib/saas/team-quota'
import { getPlan } from '@/lib/saas/plans'
import { validateGrantInput } from '@/lib/saas/grants'

// Gestes commerciaux d'une entreprise (migration 157), depuis la fiche
// boutique de l'admin. GET : support et super_admin ; POST / DELETE :
// super_admin seul. Tout est journalisé (admin.grant_bonus / admin.revoke_bonus).

const MESSAGES: Record<string, string> = {
  invalid_kind: 'Type de geste inconnu',
  invalid_quantity: 'Quantité entre 1 et 50',
  reason_required: 'Motif obligatoire (3 à 300 caractères)',
  invalid_expiry: 'La date de fin doit être dans le futur',
}

/** Situation de l'entreprise : formule, offert, limites effectives, utilisation */
async function situation(admin: any, shopId: string) {
  const account = await getAccountForShop(admin, shopId)
  if (!account) return null
  const plan = getPlan(account.plan)
  // Mêmes fonctions que l'invitation et la création de boutique (règle unique)
  const [seats, shopLimit, shopIds, { data: grants }] = await Promise.all([
    countTeamSeats(admin, account),
    getShopLimit(admin, account),
    getEntityShopIds(admin, account, { includeSuspended: true }),
    admin.from('entity_grants').select('*').eq('entity_id', account.entityId).order('granted_at', { ascending: false }),
  ])
  return {
    account,
    body: {
      entity: { id: account.entityId, name: account.name, plan: plan.id, plan_name: plan.name },
      grants: grants || [],
      limits: {
        team_seats: { plan: seats.planLimit, offered: seats.offered, effective: seats.limit, used: seats.used },
        shops: { plan: shopLimit.planLimit, offered: shopLimit.offered, effective: shopLimit.limit, used: shopIds.length },
      },
    },
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  const admin = await createAdminClient() as any
  const s = await situation(admin, shopId)
  if (!s) return NextResponse.json({ error: 'Entreprise introuvable pour cette boutique' }, { status: 404 })
  return NextResponse.json(s.body)
}

// POST { shop_id, kind, quantity, reason, expires_at? }
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  try {
    const body = await request.json()
    const check = validateGrantInput(body)
    if (!check.ok) return NextResponse.json({ error: MESSAGES[check.error], code: check.error }, { status: 400 })
    const admin = await createAdminClient() as any
    const account = await getAccountForShop(admin, body.shop_id)
    if (!account) return NextResponse.json({ error: 'Entreprise introuvable pour cette boutique' }, { status: 404 })
    const { data, error } = await admin.from('entity_grants').insert({
      entity_id: account.entityId, kind: check.kind, quantity: check.quantity,
      reason: check.reason, expires_at: check.expires_at, granted_by: auth.user.id,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writeAuditLog({
      action: 'admin.grant_bonus',
      shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: account.entityId, target_type: 'entity',
      metadata: { grant_id: data.id, entity_name: account.name, kind: check.kind, quantity: check.quantity, reason: check.reason, expires_at: check.expires_at },
      ip: getClientIp(request),
    })
    const s = await situation(admin, body.shop_id)
    return NextResponse.json({ grant: data, ...s?.body })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE ?id=&shop_id=&reason= — retrait historisé ; jamais de suspension automatique
export async function DELETE(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') || ''
    const shopId = searchParams.get('shop_id') || ''
    const reason = (searchParams.get('reason') || '').trim().slice(0, 300) || null
    const admin = await createAdminClient() as any
    const account = await getAccountForShop(admin, shopId)
    if (!account) return NextResponse.json({ error: 'Entreprise introuvable pour cette boutique' }, { status: 404 })
    const { data: grant } = await admin.from('entity_grants').select('*').eq('id', id).eq('entity_id', account.entityId).is('revoked_at', null).maybeSingle()
    if (!grant) return NextResponse.json({ error: 'Geste introuvable ou déjà retiré' }, { status: 404 })
    const { error } = await admin.from('entity_grants').update({ revoked_at: new Date().toISOString(), revoked_by: auth.user.id, revoke_reason: reason }).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const s = await situation(admin, shopId)
    const lim = s?.body.limits
    const over = lim ? {
      team_seats: lim.team_seats.effective === -1 ? 0 : Math.max(0, lim.team_seats.used - lim.team_seats.effective),
      shops: lim.shops.effective === -1 ? 0 : Math.max(0, lim.shops.used - lim.shops.effective),
    } : { team_seats: 0, shops: 0 }
    await writeAuditLog({
      action: 'admin.revoke_bonus',
      shop_id: shopId, actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: account.entityId, target_type: 'entity',
      metadata: { grant_id: id, entity_name: account.name, kind: grant.kind, quantity: grant.quantity, reason, over_limit_after: over },
      ip: getClientIp(request),
    })
    return NextResponse.json({ success: true, over_limit: over, ...s?.body })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
