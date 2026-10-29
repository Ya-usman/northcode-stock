import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator, getLocaleTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { sendUsersPush } from '@/lib/api/push-server'
import {
  REQUEST_MINUTES, HOURS_COLUMNS, approverIds, approverShops, canApproveExtension, phaseOf, requestsUnavailable, type ShopHoursRow,
} from '@/lib/api/hours-extension'
import type { StoredPermissions } from '@/lib/permissions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REQUEST_COLUMNS = 'id, minutes, message, status, created_at, expires_at, decided_at, granted_until, requested_by'

async function context(request: Request, shopId: string | null) {
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: 'not_authenticated' as const, status: 401 }
  if (!shopId || !UUID.test(shopId)) return { error: 'shop_id_required' as const, status: 400 }
  const role = await checkShopRole(supabase, user.id, shopId)
  if (!role) return { error: 'permission_denied' as const, status: 403 }
  const admin = await createAdminClient() as any
  const { data: shop } = await admin.from('shops').select(HOURS_COLUMNS).eq('id', shopId).maybeSingle()
  if (!shop) return { error: 'shop_not_found' as const, status: 404 }
  return { user, role, admin, shop: shop as ShopHoursRow & { id: string; name: string; role_permissions: StoredPermissions | null } }
}

// Demandes en attente dépassées : passées à « expirée » (aucune tâche planifiée nécessaire)
const expireStale = (admin: any, shopId: string) => admin.from('hours_extension_requests')
  .update({ status: 'expired' }).eq('shop_id', shopId).eq('status', 'pending').lt('expires_at', new Date().toISOString())

// GET /api/shops/extension-requests?scope=approver — demandes en attente de TOUTES les boutiques où l'on peut
// accepter (carte en haut de page et cloche, quelle que soit la boutique active), avec les horaires de chaque boutique.
async function approverInbox(t: (key: any) => string) {
  const { user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const admin = await createAdminClient() as any
  const shops = await approverShops(admin, user.id)
  if (!shops.length) return NextResponse.json({ approver: false, available: true, requests: [], shops: {} })
  const ids = shops.map(s => s.id)
  const exp = await admin.from('hours_extension_requests')
    .update({ status: 'expired' }).in('shop_id', ids).eq('status', 'pending').lt('expires_at', new Date().toISOString())
  if (exp.error) {
    if (requestsUnavailable(exp.error)) return NextResponse.json({ approver: true, available: false, requests: [], shops: {} })
    throw new Error(exp.error.message)
  }
  const { data: pending, error } = await admin.from('hours_extension_requests').select(`${REQUEST_COLUMNS}, shop_id`)
    .in('shop_id', ids).eq('status', 'pending').order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  const people = Array.from(new Set(((pending || []) as any[]).map(r => r.requested_by)))
  const names: Record<string, string> = {}
  if (people.length) {
    const { data } = await admin.from('profiles').select('id, full_name').in('id', people)
    for (const p of data || []) names[p.id] = p.full_name
  }
  const byId: Record<string, any> = {}
  for (const s of shops) {
    const { role_permissions, ...rest } = s
    byId[s.id] = rest
  }
  return NextResponse.json({
    approver: true, available: true, shops: byId,
    requests: ((pending || []) as any[]).map(r => ({ ...r, requester_name: names[r.requested_by] ?? null })),
  })
}

// GET /api/shops/extension-requests?shop_id — état pour l'écran « boutique fermée » (ma dernière demande, moment de la
// fermeture) et, pour qui peut accepter, les demandes en attente de la boutique.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    if (new URL(request.url).searchParams.get('scope') === 'approver') return await approverInbox(t)
    const c = await context(request, new URL(request.url).searchParams.get('shop_id'))
    if ('error' in c) return NextResponse.json({ error: t(c.error) }, { status: c.status })
    const { user, role, admin, shop } = c
    const approver = canApproveExtension(role, shop.role_permissions)
    const phase = phaseOf(shop)
    const base = { phase, can_extend: approver, available: true }
    const exp = await expireStale(admin, shop.id)
    if (exp.error) {
      if (requestsUnavailable(exp.error)) return NextResponse.json({ ...base, available: false, mine: null, pending: [] })
      throw new Error(exp.error.message)
    }
    const since = new Date(Date.now() - 12 * 3_600_000).toISOString()
    const [{ data: mine }, { data: pending }] = await Promise.all([
      admin.from('hours_extension_requests').select(REQUEST_COLUMNS).eq('shop_id', shop.id).eq('requested_by', user.id)
        .gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      approver
        ? admin.from('hours_extension_requests').select(REQUEST_COLUMNS).eq('shop_id', shop.id).eq('status', 'pending')
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [] }),
    ])
    const ids = Array.from(new Set(((pending || []) as any[]).map(r => r.requested_by)))
    const names: Record<string, string> = {}
    if (ids.length) {
      const { data: people } = await admin.from('profiles').select('id, full_name').in('id', ids)
      for (const p of people || []) names[p.id] = p.full_name
    }
    return NextResponse.json({
      ...base,
      mine: mine ?? null,
      pending: ((pending || []) as any[]).map(r => ({ ...r, requester_name: names[r.requested_by] ?? null })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/shops/extension-requests { shop_id, minutes, message } — un employé demande une prolongation
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json().catch(() => ({}))
    const c = await context(request, body.shop_id ?? null)
    if ('error' in c) return NextResponse.json({ error: t(c.error) }, { status: c.status })
    const { user, role, admin, shop } = c
    if (canApproveExtension(role, shop.role_permissions)) {
      return NextResponse.json({ error: t('extension_use_direct'), code: 'extension_use_direct' }, { status: 400 })
    }
    const minutes = Number(body.minutes)
    if (!REQUEST_MINUTES.includes(minutes)) return NextResponse.json({ error: t('extension_invalid_duration') }, { status: 400 })
    const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim().slice(0, 200) : null

    const phase = phaseOf(shop)
    if (phase !== 'after_close') {
      const key = phase === 'open' ? 'extension_shop_open' : phase === 'manual' ? 'extension_manual_override' : 'extension_before_open'
      return NextResponse.json({ error: t(key), code: key }, { status: 400 })
    }

    const exp = await expireStale(admin, shop.id)
    if (exp.error && requestsUnavailable(exp.error)) return NextResponse.json({ error: t('extension_requests_unavailable') }, { status: 503 })
    const { data: created, error } = await admin.from('hours_extension_requests')
      .insert({ shop_id: shop.id, requested_by: user.id, minutes, message }).select('id, minutes, message, status, created_at, expires_at').single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: t('extension_request_pending'), code: 'extension_request_pending' }, { status: 409 })
      if (requestsUnavailable(error)) return NextResponse.json({ error: t('extension_requests_unavailable') }, { status: 503 })
      throw new Error(error.message)
    }

    // Prévenir ceux qui peuvent accepter, chacun dans sa langue
    const approvers = (await approverIds(admin, shop.id)).filter(id => id !== user.id)
    if (approvers.length) {
      const { data: people } = await admin.from('profiles').select('id, full_name, locale').in('id', [user.id, ...approvers])
      const requester = (people || []).find((p: any) => p.id === user.id)?.full_name || user.email || ''
      const byLocale: Record<string, string[]> = {}
      for (const p of (people || []) as any[]) if (approvers.includes(p.id)) (byLocale[p.locale || 'fr'] ||= []).push(p.id)
      await Promise.all(Object.entries(byLocale).map(([locale, ids]) => {
        const tr = getLocaleTranslator(locale, 'shop_hours')
        return sendUsersPush(admin, shop.id, ids, {
          title: tr('request_push_title'),
          body: tr('request_push_body', { name: requester, duration: tr(`duration_${minutes}` as any), shop: shop.name }),
          tag: `extension-request-${created.id}`, url: '/dashboard',
        })
      }))
    }
    await writeAuditLog({ action: 'shop.extension_requested', shop_id: shop.id, actor_id: user.id, actor_email: user.email, target_id: created.id, target_type: 'hours_extension_request', metadata: { minutes, message }, ip: getClientIp(request) })
    return NextResponse.json({ request: created })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/shops/extension-requests { shop_id, id } — l'employé annule SA demande en attente
export async function DELETE(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json().catch(() => ({}))
    const c = await context(request, body.shop_id ?? null)
    if ('error' in c) return NextResponse.json({ error: t(c.error) }, { status: c.status })
    if (!UUID.test(String(body.id || ''))) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const { data, error } = await c.admin.from('hours_extension_requests').update({ status: 'cancelled' })
      .eq('id', body.id).eq('shop_id', c.shop.id).eq('requested_by', c.user.id).eq('status', 'pending').select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) return NextResponse.json({ error: t('extension_request_closed') }, { status: 409 })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
