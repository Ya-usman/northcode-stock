import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { SUPPLIER_PUBLIC_COLUMNS } from '@/lib/suppliers/columns'
import { getApiTranslator } from '@/lib/api/i18n'
import { LEAD_TIME_MAX_DAYS } from '@/lib/stock/replenishment'

// Délai de livraison habituel (migration 189) : facultatif, entier de 0 à 180 jours, vide = inconnu. Écrit seulement
// s'il est envoyé ; avant la 189 (colonne absente), l'envoyer est refusé avec un message clair.
function parseLeadTime(body: any): { set: boolean; value: number | null; bad: boolean } {
  if (!body || !('lead_time_days' in body)) return { set: false, value: null, bad: false }
  const v = body.lead_time_days
  if (v === null || v === '') return { set: true, value: null, bad: false }
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > LEAD_TIME_MAX_DAYS) return { set: true, value: null, bad: true }
  return { set: true, value: n, bad: false }
}
const missingColumn = (e: any) => e?.code === '42703' || /lead_time_days/.test(String(e?.message || ''))

// POST /api/suppliers — create a supplier
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const { shop_id, name, phone, city } = body
    if (!shop_id || !name) return NextResponse.json({ error: t('shop_name_required') }, { status: 400 })
    const lead = parseLeadTime(body)
    if (lead.bad) return NextResponse.json({ error: t('supplier_lead_time_invalid'), field: 'lead_time_days' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      // Fiche sans le solde dû (total_owed = dette : jamais renvoyée ici, voir /api/suppliers/balances)
      .from('suppliers').insert({ shop_id, name, phone: phone || null, city: city || null, ...(lead.set ? { lead_time_days: lead.value } : {}) }).select(SUPPLIER_PUBLIC_COLUMNS).single()
    if (error && lead.set && missingColumn(error)) return NextResponse.json({ error: t('supplier_lead_time_unavailable') }, { status: 400 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/suppliers — update a supplier
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const { id, shop_id, name, phone, city } = body
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })
    const lead = parseLeadTime(body)
    if (lead.bad) return NextResponse.json({ error: t('supplier_lead_time_invalid'), field: 'lead_time_days' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('suppliers')
      .update({ name, phone: phone || null, city: city || null, ...(lead.set ? { lead_time_days: lead.value } : {}) })
      .eq('id', id).eq('shop_id', shop_id)
      .select(SUPPLIER_PUBLIC_COLUMNS).single() // sans le solde dû
    if (error && lead.set && missingColumn(error)) return NextResponse.json({ error: t('supplier_lead_time_unavailable') }, { status: 400 })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: t('supplier_not_found_in_shop') }, { status: 404 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/suppliers?id=&shop_id= — soft-delete, keeps a trace unlike a
// hard delete (matches customers' deleted_at pattern)
export async function DELETE(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const shopId = searchParams.get('shop_id')
    if (!id || !shopId) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()

    const { data: supplier } = await (admin as any)
      .from('suppliers').select('name').eq('id', id).eq('shop_id', shopId).single()

    const { error } = await (admin as any)
      .from('suppliers').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'supplier.delete',
      shop_id: shopId,
      actor_id: user.id,
      actor_email: user.email,
      target_id: id,
      target_type: 'supplier',
      ip: getClientIp(request),
      metadata: {
        actor_name: actorProfile?.full_name || user.email,
        supplier_name: supplier?.name,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
