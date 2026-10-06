import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { appBaseUrl } from '@/lib/email/sender'
import { emailI18n } from '@/lib/email/i18n'
import {
  BODY_MAX, RECONTACT_GAP_MS, SUBJECT_MAX, SUPPORT_EMAIL, SUPPORT_TEMPLATES,
  buildSupportDraft, recommendedTemplate, renderSupportEmail, templateLink, whatsappUrl,
  type SupportChannel, type SupportTemplate,
} from '@/lib/support/contact'

// Admin → Activation : le support écrit à un commerçant qui débute.
//   GET  ?owner=<uuid>&template=<modèle?>  → message prêt (langue du commerçant),
//        contact, historique, désinscription ;
//   POST { owner_id, template, subject, body, channel, force? }
//        channel « email »    → envoi depuis support@stockshop.tech (réponses au support) ;
//        channel « whatsapp » → le message est ouvert dans WhatsApp par la console :
//        on enregistre seulement le contact.
// Tout administrateur, niveau support compris (décision du 7 oct. 2026 : contacter
// les clients fait partie du support ; les actions sensibles restent aux admins complets).
// Un 2e message en moins de 2 jours exige force: true (confirmation dans la console).

const resend = new Resend(process.env.RESEND_API_KEY)
/** Signature choisie dans la console (prénom) : lettres, espaces, - ' . — 2 à 40 caractères */
// Lettres latines accentuées et haoussa (ƙ, ɗ, ɓ, ƴ…) : plages Latin-1, Latin étendu A/B, API
const SENDER_RE = /^[A-Za-zÀ-ÖØ-öø-ɏɐ-ʯ][A-Za-zÀ-ÖØ-öø-ɏɐ-ʯ .'’-]{1,39}$/
const cleanSender = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : ''; return SENDER_RE.test(s) ? s : null }

async function context(admin: any, ownerId: string, senderId: string, senderOverride: string | null = null) {
  const must = <T,>(r: { data?: T; error: any }) => { if (r.error) throw new Error(r.error.message); return r.data as T }
  const owned = must<any[]>(await admin.from('shop_members').select('shop_id').eq('user_id', ownerId).eq('role', 'owner'))
  if (!owned.length) return null
  const shops = must<any[]>(await admin.from('shops').select('id, name, created_at, phone, whatsapp, deleted_at').in('id', owned.map(o => o.shop_id)).is('deleted_at', null))
  if (!shops.length) return null
  shops.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const ids = shops.map(s => s.id)
  const [profile, sender, userRes, products, onboarding, history] = await Promise.all([
    admin.from('profiles').select('full_name, locale').eq('id', ownerId).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', senderId).maybeSingle(),
    admin.auth.admin.getUserById(ownerId),
    admin.from('products').select('id', { count: 'exact', head: true }).in('shop_id', ids),
    admin.from('user_onboarding').select('nudges_unsubscribed_at').eq('user_id', ownerId).maybeSingle(),
    admin.from('support_contacts').select('id, channel, template, subject, created_at, sent_by').eq('user_id', ownerId).order('created_at', { ascending: false }).limit(10),
  ])
  for (const r of [profile, sender, products, onboarding]) if (r.error) throw new Error(r.error.message)
  // Table de la migration 167 absente : pas d'historique (l'envoi sera refusé, voir POST)
  const historyAvailable = !history.error
  if (history.error && !/support_contacts|does not exist|PGRST205/i.test(history.error.message)) throw new Error(history.error.message)
  const senderIds = Array.from(new Set((history.data || []).map((h: any) => h.sent_by).filter(Boolean))) as string[]
  const senders = senderIds.length ? must<any[]>(await admin.from('profiles').select('id, full_name').in('id', senderIds)) : []
  const senderName = new Map(senders.map(s => [s.id, s.full_name]))
  const adminEmail: string = (await admin.auth.admin.getUserById(senderId)).data?.user?.email || ''
  return {
    shop: shops[0],
    shopIds: ids,
    ownerName: profile.data?.full_name ?? null,
    locale: profile.data?.locale ?? 'fr',
    email: userRes.data?.user?.email ?? null,
    phone: shops.map(s => s.whatsapp || s.phone).find(Boolean) ?? null,
    ageDays: Math.floor((Date.now() - new Date(shops[0].created_at).getTime()) / 86_400_000),
    hasProduct: (products.count ?? 0) > 0,
    unsubscribed: !!onboarding.data?.nudges_unsubscribed_at,
    // Prénom du membre du support qui signe ; à défaut, le début de son adresse
    sender: senderOverride || (sender.data?.full_name?.trim().split(/\s+/)[0]) || adminEmail.split('@')[0] || 'StockShop',
    historyAvailable,
    history: (history.data || []).map((h: any) => ({ ...h, sent_by_name: senderName.get(h.sent_by) ?? null })),
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const url = new URL(request.url)
    const ownerId = url.searchParams.get('owner') || ''
    if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return NextResponse.json({ error: 'Compte invalide' }, { status: 400 })
    const admin = await createAdminClient() as any
    const c = await context(admin, ownerId, auth.user.id, cleanSender(url.searchParams.get('sender')))
    if (!c) return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })
    const recommended = recommendedTemplate(c)
    const asked = url.searchParams.get('template') as SupportTemplate | null
    const template = asked && SUPPORT_TEMPLATES.includes(asked) ? asked : recommended
    const i = emailI18n(c.locale)
    const draft = buildSupportDraft(i, template, { ownerName: c.ownerName, shopName: c.shop.name, sender: c.sender, appUrl: appBaseUrl() })
    return NextResponse.json({
      owner: { id: ownerId, name: c.ownerName, email: c.email, phone: c.phone, shopId: c.shop.id, shopName: c.shop.name, ageDays: c.ageDays, hasProduct: c.hasProduct },
      locale: i.locale, template, recommended, ...draft,
      hasWhatsapp: !!whatsappUrl(c.phone, 'x'),
      unsubscribed: c.unsubscribed,
      from: `${c.sender} — StockShop <${SUPPORT_EMAIL}>`,
      sender: c.sender,
      history: c.history,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const b = await request.json()
    const ownerId = String(b?.owner_id || '')
    const template = b?.template as SupportTemplate
    const channel = b?.channel as SupportChannel
    const subject = String(b?.subject ?? '').trim()
    const body = String(b?.body ?? '').replace(/\r\n/g, '\n').trim()
    if (!/^[0-9a-f-]{36}$/i.test(ownerId) || !SUPPORT_TEMPLATES.includes(template) || !['email', 'whatsapp'].includes(channel)) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }
    if (body.length < 20 || body.length > BODY_MAX) return NextResponse.json({ error: `Le message doit faire entre 20 et ${BODY_MAX} caractères.` }, { status: 400 })
    if (channel === 'email' && (subject.length < 3 || subject.length > SUBJECT_MAX)) return NextResponse.json({ error: `L’objet doit faire entre 3 et ${SUBJECT_MAX} caractères.` }, { status: 400 })

    const admin = await createAdminClient() as any
    const c = await context(admin, ownerId, auth.user.id, cleanSender(b?.sender))
    if (!c) return NextResponse.json({ error: 'Compte introuvable' }, { status: 404 })
    // Jamais d'envoi sans trace : la garde « déjà contacté » et la pause de la relance en dépendent
    if (!c.historyAvailable) return NextResponse.json({ error: 'Historique des contacts indisponible (migration 167 à appliquer) : envoi bloqué.' }, { status: 503 })

    // Contact récent : confirmation explicite demandée à la console
    const last = c.history[0]
    if (last && Date.now() - new Date(last.created_at).getTime() < RECONTACT_GAP_MS && b?.force !== true) {
      return NextResponse.json({ error: 'Contacté récemment', code: 'recent_contact', last }, { status: 409 })
    }

    let providerId: string | null = null
    let recipient: string | null = null
    if (channel === 'email') {
      if (!c.email) return NextResponse.json({ error: 'Aucune adresse e-mail pour ce compte.' }, { status: 400 })
      recipient = c.email
      const i = emailI18n(c.locale)
      const link = templateLink(template, appBaseUrl(), i.locale)
      const cta = template === 'free' ? null : i.t(`support_contact.${template}.cta`)
      const mail = renderSupportEmail(i, { body, link, cta, appUrl: appBaseUrl() })
      const { data, error } = await resend.emails.send({
        from: `${c.sender} — StockShop <${SUPPORT_EMAIL}>`,
        to: c.email,
        reply_to: SUPPORT_EMAIL,
        subject, html: mail.html, text: mail.text,
      } as any)
      if (error) return NextResponse.json({ error: `Envoi refusé : ${error.message}` }, { status: 502 })
      providerId = (data as any)?.id ?? null
    } else {
      recipient = c.phone
      if (!whatsappUrl(c.phone, body)) return NextResponse.json({ error: 'Aucun numéro WhatsApp utilisable pour ce compte.' }, { status: 400 })
    }

    const { data: row, error: insErr } = await admin.from('support_contacts').insert({
      user_id: ownerId, shop_id: c.shop.id, channel, template, locale: c.locale, recipient,
      subject: channel === 'email' ? subject : null, body, sent_by: auth.user.id, provider_id: providerId,
    }).select('id, created_at').single()
    // L'e-mail est déjà parti : une trace manquante ne doit pas faire croire à un échec
    if (insErr) console.error('[support-contact] trace non enregistrée', insErr.message)

    await writeAuditLog({
      action: 'admin.support_contact', actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: ownerId, target_type: 'user',
      metadata: { channel, template, shop_id: c.shop.id, shop_name: c.shop.name, subject: channel === 'email' ? subject : null, tier: auth.tier },
      ip: getClientIp(request),
    })

    return NextResponse.json({
      success: true, contact: row ?? null, traceSaved: !insErr,
      whatsappUrl: channel === 'whatsapp' ? whatsappUrl(c.phone, body) : null,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
