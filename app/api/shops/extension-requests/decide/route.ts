import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator, getLocaleTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { sendUsersPush } from '@/lib/api/push-server'
import { REQUEST_MINUTES, canApproveExtension, extensionErrorKey, requestsUnavailable } from '@/lib/api/hours-extension'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/shops/extension-requests/decide { id, approve, minutes? } — le propriétaire, ou une personne qui a le droit
// « Prolonger », accepte (prolongation accordée à partir de maintenant, migration 186) ou refuse une demande.
// L'employé est prévenu dans sa langue ; son écran se débloque de lui-même (la boutique est diffusée en direct).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { id, approve, minutes } = await request.json().catch(() => ({}))
    if (!UUID.test(String(id || '')) || typeof approve !== 'boolean') return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    if (minutes != null && !REQUEST_MINUTES.includes(Number(minutes))) return NextResponse.json({ error: t('extension_invalid_duration') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: req, error: reqErr } = await admin.from('hours_extension_requests')
      .select('id, shop_id, requested_by, minutes, status').eq('id', id).maybeSingle()
    if (reqErr) {
      if (requestsUnavailable(reqErr)) return NextResponse.json({ error: t('extension_requests_unavailable') }, { status: 503 })
      throw new Error(reqErr.message)
    }
    if (!req) return NextResponse.json({ error: t('extension_request_closed') }, { status: 404 })

    const role = await checkShopRole(supabase, user.id, req.shop_id)
    const { data: shop } = await admin.from('shops').select('name, timezone, role_permissions').eq('id', req.shop_id).maybeSingle()
    if (!canApproveExtension(role, shop?.role_permissions ?? null)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    let grantedUntil: string | null = null
    if (approve) {
      const { data, error } = await admin.rpc('approve_hours_extension_request', { p_request_id: id, p_decided_by: user.id, p_minutes: minutes ?? null })
      if (error) {
        const key = extensionErrorKey(error)
        return NextResponse.json({ error: key ? t(key as any) : error.message, code: key ?? undefined }, { status: 400 })
      }
      grantedUntil = data?.hours_extension_until ?? null
    } else {
      const { data, error } = await admin.from('hours_extension_requests')
        .update({ status: 'refused', decided_by: user.id, decided_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'pending').select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) return NextResponse.json({ error: t('extension_request_closed') }, { status: 409 })
    }

    // Prévenir l'employé, dans sa langue
    const { data: person } = await admin.from('profiles').select('locale').eq('id', req.requested_by).maybeSingle()
    const locale = person?.locale || 'fr'
    const tr = getLocaleTranslator(locale, 'shop_hours')
    const until = grantedUntil
      ? new Date(grantedUntil).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: shop?.timezone || undefined })
      : null
    await sendUsersPush(admin, req.shop_id, [req.requested_by], approve
      ? { title: tr('granted_push_title'), body: tr('granted_push_body', { shop: shop?.name ?? '', time: until ?? '' }), tag: `extension-request-${id}`, url: '/dashboard' }
      : { title: tr('refused_push_title'), body: tr('refused_push_body', { shop: shop?.name ?? '' }), tag: `extension-request-${id}`, url: '/dashboard' })

    await writeAuditLog({
      action: approve ? 'shop.extension_request_approved' : 'shop.extension_request_refused', shop_id: req.shop_id,
      actor_id: user.id, actor_email: user.email, target_id: id, target_type: 'hours_extension_request',
      metadata: { minutes: minutes ?? req.minutes, requested_by: req.requested_by, granted_until: grantedUntil }, ip: getClientIp(request),
    })
    return NextResponse.json({ success: true, approved: approve, hours_extension_until: grantedUntil })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
