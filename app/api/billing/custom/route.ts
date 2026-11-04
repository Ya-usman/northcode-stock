import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Resend } from 'resend'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid } from '@/lib/api/validate'
import { getApiTranslator, getLocaleTranslator, normalizeLocale } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { esc, emailShell } from '@/lib/email/brand'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { countTeamSeats } from '@/lib/saas/team-quota'
import { needsCustom, quoteState } from '@/lib/saas/custom-plan'

// Offre sur mesure, côté client (propriétaire seulement ; règle : lib/saas/custom-plan, migration 211).
//   GET  ?shop_id=…   demandes et devis de l'entreprise (état calculé : un devis dépassé est « expiré »)
//   POST { shop_id, shops, seats, period, needs?, phone? }   demande de devis : une seule ouverte à la fois ;
//        e-mail de confirmation au propriétaire, alerte à l'équipe StockShop.

const resend = new Resend(process.env.RESEND_API_KEY)

async function owner(request: Request, shopId: string) {
  const t = getApiTranslator(request)
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  const role = await checkShopRole(userClient, user.id, shopId)
  if (!account || !(account.ownerId === user.id || role === 'owner')) return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return { t, user, admin, account }
}

const COLUMNS = 'id, status, req_shops, req_seats, req_period, req_needs, currency, monthly_price, billing_period, period_total, limit_shops, limit_seats, client_note, decline_reason, valid_until, price_until, token, created_at, quoted_at, paid_at'

export async function GET(request: Request) {
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const c = await owner(request, shopId)
  if ('error' in c) return c.error
  const { data, error } = await c.admin.from('custom_quotes').select(COLUMNS).eq('entity_id', c.account.entityId).order('created_at', { ascending: false }).limit(10)
  if (error) return NextResponse.json({ quotes: [], current: null })
  const { data: ent } = await c.admin.from('entities').select('custom_quote_id').eq('id', c.account.entityId).maybeSingle()
  const quotes = (data || []).map((q: any) => ({ ...q, state: quoteState(q) }))
  return NextResponse.json({ quotes, current: ent?.custom_quote_id ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}

const requestSchema = z.object({
  shop_id: uuid,
  shops: z.number().int().min(1).max(200),
  seats: z.number().int().min(0).max(2000),
  period: z.enum(['monthly', 'semiannual', 'annual']),
  needs: z.string().trim().max(1000).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'billing')
  if (limited) return limited
  const v = validateBody(requestSchema, await request.json().catch(() => ({})))
  if ('error' in v) return v.error
  const c = await owner(request, v.data.shop_id)
  if ('error' in c) return c.error
  const { t, admin, account, user } = c
  if (!needsCustom(v.data.shops, v.data.seats)) return NextResponse.json({ error: t('custom_min'), code: 'custom_min' }, { status: 400 })

  // Une seule demande ouverte à la fois (demandée, ou devis envoyé encore valable)
  const { data: open } = await admin.from('custom_quotes').select('id, status, valid_until').eq('entity_id', account.entityId).in('status', ['requested', 'quoted'])
  if ((open || []).some((q: any) => quoteState(q) === 'requested' || quoteState(q) === 'quoted'))
    return NextResponse.json({ error: t('custom_already_open'), code: 'custom_already_open' }, { status: 409 })

  const { data: row, error } = await admin.from('custom_quotes').insert({
    entity_id: account.entityId, shop_id: v.data.shop_id, requested_by: user.id,
    req_shops: v.data.shops, req_seats: v.data.seats, req_period: v.data.period,
    req_needs: v.data.needs || null, req_phone: v.data.phone || null,
  }).select('id, created_at').single()
  if (error) return NextResponse.json({ error: t('invalid_data') }, { status: 500 })

  await writeAuditLog({
    action: 'billing.custom_request', shop_id: v.data.shop_id, actor_id: user.id, actor_email: user.email, target_id: row.id, target_type: 'custom_quote',
    metadata: { shops: v.data.shops, seats: v.data.seats, period: v.data.period }, ip: getClientIp(request),
  })

  // E-mails : confirmation au propriétaire (sa langue), alerte à l'équipe (français) ; jamais bloquants
  if (process.env.RESEND_API_KEY) {
    const [{ data: profile }, shopIds, seats] = await Promise.all([
      admin.from('profiles').select('full_name, locale').eq('id', user.id).maybeSingle(),
      getEntityShopIds(admin, account, { includeSuspended: true }),
      countTeamSeats(admin, account),
    ])
    const locale = normalizeLocale(profile?.locale)
    const tm = getLocaleTranslator(locale, 'custom_quote')
    const appUrl = appBaseUrl()
    if (user.email) {
      await resend.emails.send({
        from: EMAIL_FROM, to: user.email, subject: tm('request_email_subject'),
        html: emailShell({ appUrl, lang: locale, footer: esc(tm('email_footer')), body: `
          <p style="margin:0 0 12px;font-size:15px;color:#111827;">${esc(tm('greeting', { name: profile?.full_name || '' }))}</p>
          <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#374151;">${esc(tm('request_email_body', { shops: v.data.shops, seats: v.data.seats }))}</p>` }),
      }).catch(() => {})
    }
    const adminEmails = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
    if (adminEmails.length) {
      await resend.emails.send({
        from: EMAIL_FROM, to: adminEmails, subject: `Demande de devis sur mesure : ${account.name || 'entreprise'}`,
        html: `<p><strong>${esc(account.name || '')}</strong> (formule ${esc(account.plan)}) demande un devis : ${v.data.shops} boutiques, ${v.data.seats} employés, durée ${esc(v.data.period)}.</p>
          <p>Aujourd'hui : ${shopIds.length} boutique(s), ${seats.used} employé(s).${v.data.phone ? ` WhatsApp : ${esc(v.data.phone)}.` : ''}</p>
          ${v.data.needs ? `<p>Besoins : ${esc(v.data.needs)}</p>` : ''}
          <p><a href="${appUrl}/fr/admin/quotes">Ouvrir dans l'administration</a></p>`,
      }).catch(() => {})
    }
  }
  return NextResponse.json({ ok: true, id: row.id })
}
