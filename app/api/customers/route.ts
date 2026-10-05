import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { customerSchema } from '@/lib/validations/customer'

// Fiche client PAR LE SERVEUR (lot 2 permissions, 5 oct. 2026) : création,
// modification, suppression douce. Droit « Clients » en modification (règle
// unique lib/permissions). Même schéma de validation que le formulaire
// (lib/validations/customer.ts). Jamais de fusion automatique : deux « Job »
// peuvent être deux personnes (voir /api/customers/merge).

const ZOD_TO_ERROR: Record<string, string> = { name: 'name_required', phone: 'phone_invalid', credit_limit: 'credit_limit_invalid' }

function parseCustomer(body: any, t: (k: any) => string) {
  const parsed = customerSchema.safeParse({
    name: typeof body?.name === 'string' ? body.name.trim() : '',
    phone: typeof body?.phone === 'string' ? body.phone.trim() : '',
    city: typeof body?.city === 'string' ? body.city.trim() : '',
    credit_limit: body?.credit_limit == null || body.credit_limit === '' ? '' : String(body.credit_limit),
  })
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? '')
    return { error: NextResponse.json({ error: t(ZOD_TO_ERROR[field] ?? 'invalid_data'), field }, { status: 400 }) }
  }
  const d = parsed.data
  return { value: { name: d.name, phone: d.phone || null, city: d.city || null, credit_limit: d.credit_limit ? Number(d.credit_limit) : null } }
}

async function authorize(request: Request, shop_id: string) {
  const t = getApiTranslator(request)
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (!shop_id) return { error: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shop_id)
  if (!role || !(await canWriteFeature(supabase, role, shop_id, 'customers'))) {
    return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  }
  return { user, t }
}

// POST /api/customers — { shop_id, name, phone?, city?, credit_limit? }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const auth = await authorize(request, body?.shop_id)
    if ('error' in auth) return auth.error
    const parsed = parseCustomer(body, auth.t)
    if ('error' in parsed) return parsed.error
    const admin = await createAdminClient() as any
    const { data, error } = await admin.from('customers').insert({ ...parsed.value, shop_id: body.shop_id }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writeAuditLog({ action: 'customer.create', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: data.id, target_type: 'customer', metadata: { name: data.name }, ip: getClientIp(request) })
    return NextResponse.json({ customer: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/customers — { id, shop_id, name, phone?, city?, credit_limit? }
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const auth = await authorize(request, body?.shop_id)
    if ('error' in auth) return auth.error
    if (!body.id) return NextResponse.json({ error: auth.t('invalid_data') }, { status: 400 })
    const parsed = parseCustomer(body, auth.t)
    if ('error' in parsed) return parsed.error
    const admin = await createAdminClient() as any
    const { data: before } = await admin.from('customers').select('id, name, phone, city, credit_limit').eq('id', body.id).eq('shop_id', body.shop_id).is('deleted_at', null).maybeSingle()
    if (!before) return NextResponse.json({ error: auth.t('customer_not_found') }, { status: 404 })
    const { data, error } = await admin.from('customers').update(parsed.value).eq('id', body.id).eq('shop_id', body.shop_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of ['name', 'phone', 'city', 'credit_limit'] as const) if ((before[k] ?? null) !== (data[k] ?? null)) changes[k] = { from: before[k] ?? null, to: data[k] ?? null }
    if (Object.keys(changes).length) {
      await writeAuditLog({ action: 'customer.update', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: data.id, target_type: 'customer', metadata: { name: data.name, changes }, ip: getClientIp(request) })
    }
    return NextResponse.json({ customer: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/customers?id=&shop_id= — suppression douce (historique des ventes conservé)
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id') || ''
    const shop_id = searchParams.get('shop_id') || ''
    const auth = await authorize(request, shop_id)
    if ('error' in auth) return auth.error
    if (!id) return NextResponse.json({ error: auth.t('invalid_data') }, { status: 400 })
    const admin = await createAdminClient() as any
    const { data: customer } = await admin.from('customers').select('id, name, total_debt').eq('id', id).eq('shop_id', shop_id).is('deleted_at', null).maybeSingle()
    if (!customer) return NextResponse.json({ error: auth.t('customer_not_found') }, { status: 404 })
    if (Number(customer.total_debt) > 0) return NextResponse.json({ error: auth.t('customer_has_debt') }, { status: 400 })
    const { error } = await admin.from('customers').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shop_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writeAuditLog({ action: 'customer.delete', shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: id, target_type: 'customer', metadata: { name: customer.name }, ip: getClientIp(request) })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
