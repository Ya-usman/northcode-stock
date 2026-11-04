import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getLocaleTranslator, normalizeLocale } from '@/lib/api/i18n'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { esc, emailShell } from '@/lib/email/brand'
import { getCountry, getBillingCurrency, BILLING_PERIODS, type BillingPeriod } from '@/lib/saas/countries'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { getPricingCountry } from '@/lib/saas/pricing-country'
import { countTeamSeats } from '@/lib/saas/team-quota'
import { QUOTE_VALID_DAYS, addDays, quoteState, quoteTotal, suggestedMonthly } from '@/lib/saas/custom-plan'
import { newQuoteToken } from '@/lib/saas/custom-plan-server'
import { buildCustomQuoteDoc } from '@/lib/pdf/custom-quote-doc'
import { formatCurrency } from '@/lib/utils/currency'

// Devis sur mesure, administration (migration 211). GET : support et super_admin ; POST : super_admin seul.
//   GET                → liste (état calculé, entreprise, utilisation actuelle)
//   GET ?id=…          → fiche : demande, utilisation, pays de tarification, prix conseillé
//   POST { action: 'send', id, monthly_price, billing_period, limit_shops, limit_seats, client_note?, admin_note? }
//        → devis complet (total, lien, 15 jours), e-mail au propriétaire avec le PDF ; renvoie le texte WhatsApp
//   POST { action: 'extend', id }            → 15 jours de plus (devis envoyé ou expiré), e-mail renvoyé
//   POST { action: 'decline', id, reason }   → refus (motif), e-mail court au propriétaire
// Tout est journalisé (admin.custom_quote_*).

const resend = new Resend(process.env.RESEND_API_KEY)
const DATE_LOCALE: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }
const day = (iso: string, locale: string) => { try { return new Date(iso).toLocaleDateString(DATE_LOCALE[locale] || 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return iso.slice(0, 10) } }

async function context(admin: any, q: any) {
  const shopIds = await getEntityShopIds(admin, { entityId: q.entity_id }, { includeSuspended: true })
  const account = shopIds.length ? await getAccountForShop(admin, shopIds[0]) : null
  const pricing = account ? await getPricingCountry(admin, account) : null
  const country = getCountry(pricing?.country || account?.billing_country)
  const currency = getBillingCurrency(country)
  const seats = account ? await countTeamSeats(admin, account) : null
  return { account, shopIds, pricing, country, currency, used: { shops: shopIds.length, seats: seats?.used ?? 0 } }
}

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const admin = await createAdminClient() as any
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    const { data: q } = await admin.from('custom_quotes').select('*').eq('id', id).maybeSingle()
    if (!q) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
    const c = await context(admin, q)
    const { data: ent } = await admin.from('entities').select('name, plan, plan_expires_at').eq('id', q.entity_id).maybeSingle()
    return NextResponse.json({
      quote: { ...q, state: quoteState(q) }, entity: ent, used: c.used,
      pricing: { country: c.country.code, country_name: c.country.name, currency: c.currency, reason: c.pricing?.reason ?? 'declared' },
      prices: { business: c.country.prices.business, seat: c.country.addons.seat, shop: c.country.addons.shop },
      suggested_monthly: suggestedMonthly(c.country.prices.business, c.country.addons, q.limit_shops ?? q.req_shops, q.limit_seats ?? q.req_seats),
      app_url: appBaseUrl(),
    })
  }
  const { data } = await admin.from('custom_quotes')
    .select('id, entity_id, status, req_shops, req_seats, req_period, monthly_price, period_total, currency, valid_until, price_until, created_at, quoted_at, paid_at, entities(name)')
    .order('created_at', { ascending: false }).limit(100)
  return NextResponse.json({ quotes: (data || []).map((q: any) => ({ ...q, entity_name: q.entities?.name ?? '', entities: undefined, state: quoteState(q) })) })
}

/** E-mail du devis au propriétaire, avec le PDF ; renvoie le texte WhatsApp prêt à copier */
async function sendQuoteEmail(admin: any, request: Request, q: any, c: Awaited<ReturnType<typeof context>>): Promise<{ email: string; whatsapp: string; link: string }> {
  const ownerId = c.account?.ownerId
  const [{ data: profile }, { data: authUser }] = await Promise.all([
    ownerId ? admin.from('profiles').select('full_name, locale').eq('id', ownerId).maybeSingle() : Promise.resolve({ data: null }),
    ownerId ? admin.auth.admin.getUserById(ownerId) : Promise.resolve({ data: null }),
  ])
  const locale = normalizeLocale(profile?.locale)
  const tm = getLocaleTranslator(locale, 'custom_quote')
  const tp = getLocaleTranslator(locale, 'billing_page')
  const appUrl = appBaseUrl()
  const link = `${appUrl}/${locale}/billing/quote/${q.token}`
  const money = (n: number) => formatCurrency(Number(n), q.currency)
  const period = q.billing_period as BillingPeriod
  const periodName = tp(`period_${period}` as any)
  const reference = `DEV-${String(q.id).slice(0, 8).toUpperCase()}`
  const validStr = day(q.valid_until, locale)
  const months = BILLING_PERIODS[period].months
  // Facture lisible : formule × nombre de mois, puis la remise de la durée (mois offerts), puis le total
  const gross = Number(q.monthly_price) * months
  const discount = Math.round((gross - Number(q.period_total)) * 100) / 100
  const lines = [
    { label: tm('pdf_line_plan'), detail: `${tm('pdf_line_plan_detail', { shops: q.limit_shops, seats: q.limit_seats })} - ${money(q.monthly_price)} x ${months}`, amount: money(gross) },
    ...(discount > 0 ? [{ label: tm('pdf_line_discount'), detail: tm(`pdf_gift_${period}` as any), amount: `- ${money(discount)}` }] : []),
  ]
  // Logo officiel blanc pour le bandeau (repli : icône seule)
  const asset = async (path: string) => { try { const r = await fetch(new URL(path, request.url)); return r.ok ? Buffer.from(await r.arrayBuffer()).toString('base64') : null } catch { return null } }
  const [wordmark, logo] = await Promise.all([asset('/brand/stockshop-wordmark-white.png'), asset('/logo-icon.png')])
  const { doc, fileName } = await buildCustomQuoteDoc({
    reference, dateStr: day(new Date().toISOString(), locale), validUntilStr: validStr,
    clientName: c.account?.name || '', clientCountry: c.country.name,
    lines, totalLabel: tm('pdf_total', { period: periodName }), totalAmount: money(q.period_total), payUrl: link, note: q.client_note,
    labels: {
      title: tm('pdf_title'), reference: tm('pdf_reference'), date: tm('pdf_date'), validUntil: tm('pdf_valid_until'), client: tm('pdf_client'),
      country: tm('pdf_country'), colItem: tm('pdf_col_item'), colDetail: tm('pdf_col_detail'), colAmount: tm('pdf_col_amount'),
      pay: tm('pdf_pay'), noteTitle: tm('pdf_note'), footer: tm('pdf_footer'),
    },
  }, { logoBase64: logo, wordmarkBase64: wordmark })
  const pdf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
  const whatsapp = tm('whatsapp_text', { name: profile?.full_name || '', shops: q.limit_shops, seats: q.limit_seats, monthly: money(q.monthly_price), total: money(q.period_total), period: periodName, date: validStr, link })
  let email = 'skipped'
  const to = (authUser as any)?.user?.email ?? null
  if (to && process.env.RESEND_API_KEY) {
    const { error } = await resend.emails.send({
      from: EMAIL_FROM, to, subject: tm('quote_email_subject', { ref: reference }),
      html: emailShell({ appUrl, lang: locale, footer: esc(tm('email_footer')), body: `
        <p style="margin:0 0 12px;font-size:15px;color:#111827;">${esc(tm('greeting', { name: profile?.full_name || '' }))}</p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#374151;">${esc(tm('quote_email_body', { shops: q.limit_shops, seats: q.limit_seats, monthly: money(q.monthly_price), total: money(q.period_total), period: periodName, date: validStr }))}</p>
        ${q.client_note ? `<p style="margin:0 0 12px;font-size:14px;line-height:1.55;color:#374151;">${esc(q.client_note)}</p>` : ''}
        <p style="margin:0 0 18px;"><a href="${link}" style="background:#073e8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${esc(tm('quote_email_cta'))}</a></p>
        <p style="margin:0 0 14px;font-size:13px;color:#6b7280;">${esc(tm('quote_email_attachment'))}</p>` }),
      attachments: [{ filename: fileName, content: pdf }],
    } as any)
    email = error ? `error: ${error.message}` : 'sent'
  } else if (!to) email = 'no_owner_email'
  return { email, whatsapp, link }
}

export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const admin = await createAdminClient() as any
  const { data: q } = await admin.from('custom_quotes').select('*').eq('id', String(body?.id || '')).maybeSingle()
  if (!q) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 })
  const state = quoteState(q)
  const now = new Date()
  const audit = (action: 'admin.custom_quote_send' | 'admin.custom_quote_extend' | 'admin.custom_quote_decline', metadata: Record<string, unknown>) => writeAuditLog({
    action, shop_id: q.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: q.id, target_type: 'custom_quote', metadata, ip: getClientIp(request),
  })

  if (body.action === 'send') {
    if (!['requested', 'quoted', 'expired'].includes(state)) return NextResponse.json({ error: 'Ce devis ne peut plus être modifié' }, { status: 409 })
    const monthly = Number(body.monthly_price), shops = Math.floor(Number(body.limit_shops)), seats = Math.floor(Number(body.limit_seats))
    const period = String(body.billing_period) as BillingPeriod
    if (!(monthly > 0 && monthly < 1e9)) return NextResponse.json({ error: 'Prix mensuel invalide' }, { status: 400 })
    if (!['monthly', 'semiannual', 'annual'].includes(period)) return NextResponse.json({ error: 'Durée invalide' }, { status: 400 })
    if (!(shops >= 1 && shops <= 200) || !(seats >= 0 && seats <= 2000)) return NextResponse.json({ error: 'Limites invalides' }, { status: 400 })
    const c = await context(admin, q)
    const patch = {
      status: 'quoted', currency: c.currency, pricing_country: c.country.code,
      suggested_monthly: suggestedMonthly(c.country.prices.business, c.country.addons, shops, seats),
      monthly_price: monthly, billing_period: period, period_total: quoteTotal(monthly, period), limit_shops: shops, limit_seats: seats,
      client_note: String(body.client_note || '').trim().slice(0, 1000) || null, admin_note: String(body.admin_note || '').trim().slice(0, 1000) || null,
      valid_until: addDays(now, QUOTE_VALID_DAYS).toISOString(), token: q.token || newQuoteToken(),
      quoted_by: auth.user.id, quoted_at: now.toISOString(), sent_at: now.toISOString(), updated_at: now.toISOString(),
    }
    // Écriture conditionnée à l'état lu (deux envois simultanés ne s'écrasent pas)
    const { data: done } = await admin.from('custom_quotes').update(patch).eq('id', q.id).eq('status', q.status).select('*')
    if (!done?.length) return NextResponse.json({ error: 'Le devis a changé entre-temps, rechargez' }, { status: 409 })
    const sent = await sendQuoteEmail(admin, request, done[0], c)
    await audit('admin.custom_quote_send', { monthly_price: monthly, suggested: patch.suggested_monthly, period, total: patch.period_total, currency: c.currency, shops, seats, email: sent.email })
    return NextResponse.json({ ok: true, ...sent })
  }

  if (body.action === 'extend') {
    if (!['quoted', 'expired'].includes(state)) return NextResponse.json({ error: 'Seul un devis envoyé ou expiré se prolonge' }, { status: 409 })
    const valid_until = addDays(now, QUOTE_VALID_DAYS).toISOString()
    const { data: done } = await admin.from('custom_quotes').update({ status: 'quoted', valid_until, sent_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', q.id).eq('status', q.status).select('*')
    if (!done?.length) return NextResponse.json({ error: 'Le devis a changé entre-temps, rechargez' }, { status: 409 })
    const sent = await sendQuoteEmail(admin, request, done[0], await context(admin, q))
    await audit('admin.custom_quote_extend', { valid_until, email: sent.email })
    return NextResponse.json({ ok: true, ...sent })
  }

  if (body.action === 'decline') {
    const reason = String(body.reason || '').trim()
    if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
    if (!['requested', 'quoted', 'expired'].includes(state)) return NextResponse.json({ error: 'Ce devis ne peut plus être refusé' }, { status: 409 })
    const { data: done } = await admin.from('custom_quotes').update({ status: 'declined', decline_reason: reason, updated_at: now.toISOString() }).eq('id', q.id).eq('status', q.status).select('id')
    if (!done?.length) return NextResponse.json({ error: 'Le devis a changé entre-temps, rechargez' }, { status: 409 })
    await audit('admin.custom_quote_decline', { reason })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
}
