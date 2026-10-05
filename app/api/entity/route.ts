import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isAccountOwner, isTeamManager } from '@/lib/team/roles'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { isValidPhone } from '@/lib/validations/customer'
import { countTeamSeats, resolveAccount, getAccountShopIds, getShopLimit } from '@/lib/saas/team-quota'

// /api/entity?shop_id=… — l'ENTREPRISE de la boutique (migration 153).
//  GET   : propriétaire et gestion d'équipe (Manager, Responsable) — lecture ;
//          les données de facturation ne sont renvoyées qu'au propriétaire.
//  PATCH : propriétaire seulement. Modifiables : nom (le confirme), coordonnées
//          de l'entreprise, profil de facturation. JAMAIS ici : abonnement,
//          propriétaire, pays de facturation (figé à l'inscription, comme
//          shops.billing_country — seul le super_admin le change), compte interne.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TEXT_LIMITS: Record<string, number> = {
  name: 120, address: 200, city: 80, billing_contact_name: 120, billing_address: 200, billing_city: 80, tax_id: 60,
}
const EDITABLE = ['name', 'address', 'city', 'phone', 'email', 'billing_contact_name', 'billing_email', 'billing_phone', 'billing_address', 'billing_city', 'tax_id'] as const

async function load(request: Request) {
  const t = getApiTranslator(request)
  const shopId = new URL(request.url).searchParams.get('shop_id')
  if (!shopId) return { error: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  const admin = createAdminClient() as any
  const account = await resolveAccount(admin, shopId)
  if (!account?.entityId) return { error: NextResponse.json({ error: t('shop_not_found') }, { status: 404 }) }
  return { t, user, role, admin, account, shopId }
}

export async function GET(request: Request) {
  const ctx = await load(request)
  if ('error' in ctx) return ctx.error
  const { t, role, admin, account } = ctx
  if (!isTeamManager(role)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

  const { data: e } = await admin.from('entities').select('*').eq('id', account.entityId).single()
  const { data: owner } = e?.owner_user_id ? await admin.from('profiles').select('full_name').eq('id', e.owner_user_id).maybeSingle() : { data: null }
  const owner_view = isAccountOwner(role)
  const [seats, shopIds, shopLimit] = await Promise.all([
    countTeamSeats(admin, account),
    getAccountShopIds(admin, account, { includeSuspended: true }),
    getShopLimit(admin, account),
  ])

  return NextResponse.json({
    entity: {
      id: e.id, name: e.name, name_confirmed: e.name_confirmed, country: e.country,
      address: e.address, city: e.city, phone: e.phone, email: e.email,
      establishment_count: shopIds.length,
      owner_name: owner?.full_name ?? null,
      ...(owner_view ? {
        billing_contact_name: e.billing_contact_name, billing_email: e.billing_email, billing_phone: e.billing_phone,
        billing_address: e.billing_address, billing_city: e.billing_city, billing_country: e.billing_country, tax_id: e.tax_id,
        plan: e.plan, plan_expires_at: e.plan_expires_at, trial_ends_at: e.trial_ends_at, plan_grace_ends_at: e.plan_grace_ends_at,
        // Limites effectives (formule + offert) ; *_offered > 0 → « dont N offert »
        quota: {
          shops_used: shopIds.length, shops_limit: shopLimit.limit, shops_offered: shopLimit.offered,
          members_used: seats.used, members_limit: seats.limit, members_offered: seats.offered,
        },
      } : {}),
    },
    can_edit: owner_view,
  })
}

export async function PATCH(request: Request) {
  const ctx = await load(request)
  if ('error' in ctx) return ctx.error
  const { t, user, role, admin, account, shopId } = ctx
  if (!isAccountOwner(role)) return NextResponse.json({ error: t('owner_only_entity') }, { status: 403 })

  const body = await request.json().catch(() => ({}))
  const updates: Record<string, string | null | boolean> = {}
  for (const f of EDITABLE) {
    if (!(f in body)) continue
    const v = body[f]
    if (v !== null && typeof v !== 'string') return NextResponse.json({ error: t('invalid_data'), field: f }, { status: 400 })
    const clean = typeof v === 'string' ? v.trim() : ''
    if (f === 'name' && !clean) return NextResponse.json({ error: t('entity_name_required'), field: f }, { status: 400 })
    if (TEXT_LIMITS[f] && clean.length > TEXT_LIMITS[f]) return NextResponse.json({ error: t('entity_field_too_long'), field: f }, { status: 400 })
    if ((f === 'email' || f === 'billing_email') && clean && (clean.length > 254 || !EMAIL_RE.test(clean))) return NextResponse.json({ error: t('shop_email_invalid'), field: f }, { status: 400 })
    if ((f === 'phone' || f === 'billing_phone') && clean && (clean.length > 30 || !isValidPhone(clean))) return NextResponse.json({ error: t('shop_phone_invalid'), field: f }, { status: 400 })
    updates[f] = clean ? ((f === 'email' || f === 'billing_email') ? clean.toLowerCase() : clean) : null
  }
  // Enregistrer le nom (même inchangé) = le propriétaire le confirme
  if ('name' in updates || body.confirm_name === true) updates.name_confirmed = true
  if (!Object.keys(updates).length) return NextResponse.json({ error: t('no_valid_fields') }, { status: 400 })

  const { data: before } = await admin.from('entities').select(Object.keys(updates).join(',')).eq('id', account.entityId).single()
  const { error } = await admin.from('entities').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', account.entityId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const changed = Object.keys(updates).filter(k => (before as any)?.[k] !== updates[k])
  if (changed.length) {
    await writeAuditLog({
      action: 'entity.update',
      shop_id: shopId,
      actor_id: user.id,
      actor_email: user.email,
      target_id: account.entityId,
      target_type: 'entity',
      metadata: {
        before: Object.fromEntries(changed.map(k => [k, (before as any)?.[k] ?? null])),
        after: Object.fromEntries(changed.map(k => [k, updates[k]])),
      },
      ip: getClientIp(request),
    })
  }
  return NextResponse.json({ success: true })
}
