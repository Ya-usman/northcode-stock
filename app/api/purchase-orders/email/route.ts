import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { canViewCost, canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator, getLocaleTranslator, normalizeLocale } from '@/lib/api/i18n'
import { updatePoStatusAtomically } from '@/lib/api/purchase-order-status'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { esc, emailShell } from '@/lib/email/brand'
import { buildPoMessage, poPdfLabels, reorderOriginalRef } from '@/lib/suppliers/po-message'
import { buildPurchaseOrderDoc } from '@/lib/pdf/purchase-order-doc'
import { PRODUCT_UNITS } from '@/lib/import/products-import'
import { formatCurrency } from '@/lib/utils/currency'
import { resolveCurrencyCode } from '@/lib/saas/currencies'

// Envoi d'un bon de commande par e-mail (validé le 31 oct. 2026)
//
// POST { id, shop_id, locale, copy } : expédie le bon au fournisseur depuis StockShop.
//   • Destinataire : TOUJOURS l'e-mail du fournisseur enregistré en base (jamais une adresse venue du navigateur).
//   • Texte et PDF fabriqués ICI, à partir du bon réel (lib/suppliers/po-message + lib/pdf/purchase-order-doc) :
//     personne ne peut faire partir un autre document depuis notre domaine.
//   • Réponse adressée à l'e-mail de la boutique, sinon à celui de l'expéditeur (décision A) ; copie à l'expéditeur
//     si demandée.
//   • Droits : gérer les bons de la boutique (« Fournisseurs » en modification) ; prix seulement avec le droit au coût.
//   • Limites : 20 envois par heure et par personne, 5 par bon et par jour (comptés sur purchase_order_emails).
//   • Bon en brouillon envoyé avec succès → « Envoyé » (décision B, matrice de statuts) ; échec → statut inchangé.
//   • Chaque tentative (réussie ou non) est gardée dans purchase_order_emails (migration 192) et le succès dans le
//     journal d'audit.
// GET ?id=&shop_id= : historique des envois du bon (journal), pour qui voit « Fournisseurs » dans la boutique.

const resend = new Resend(process.env.RESEND_API_KEY)
const MAX_PER_USER_HOUR = 20
const MAX_PER_PO_DAY = 5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_LOCALE: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }

/** Logo du bandeau du PDF, lu sur le site lui-même ; sans lui, le PDF garde le carré « S » */
async function logoBase64(request: Request): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(new URL('/logo-icon.png', request.url), { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer()).toString('base64')
  } catch { return null }
}

function formatDate(d: string, locale: string): string {
  const x = new Date(d)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }
  try { return x.toLocaleDateString(DATE_LOCALE[locale] || 'fr-FR', opts) } catch { return x.toLocaleDateString('fr-FR', opts) }
}

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, locale: rawLocale, copy } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })
    const locale = normalizeLocale(rawLocale)

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data: po } = await admin
      .from('purchase_orders')
      .select('id, shop_id, reference, status, notes, created_at, is_opening_balance, supplier_id, purchase_order_items(product_name, unit, quantity_ordered, unit_price), suppliers(name, phone, city, email, shop_id)')
      .eq('id', id).eq('shop_id', shop_id).maybeSingle()
    if (!po || po.is_opening_balance) return NextResponse.json({ error: t('po_not_found') }, { status: 404 })
    if (po.status !== 'draft' && po.status !== 'sent')
      return NextResponse.json({ error: t('po_email_not_sendable') }, { status: 409 })

    const recipient = String(po.suppliers?.email || '').trim()
    if (!EMAIL_RE.test(recipient)) return NextResponse.json({ error: t('po_email_no_recipient') }, { status: 400 })

    // Limites, comptées sur l'historique (réussites et échecs)
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const dayAgo = new Date(Date.now() - 86400_000).toISOString()
    const [{ count: byUser }, { count: byPo }] = await Promise.all([
      admin.from('purchase_order_emails').select('id', { count: 'exact', head: true }).eq('sent_by', user.id).gte('created_at', hourAgo),
      admin.from('purchase_order_emails').select('id', { count: 'exact', head: true }).eq('purchase_order_id', id).gte('created_at', dayAgo),
    ])
    if ((byUser ?? 0) >= MAX_PER_USER_HOUR) return NextResponse.json({ error: t('po_email_rate_user') }, { status: 429 })
    if ((byPo ?? 0) >= MAX_PER_PO_DAY) return NextResponse.json({ error: t('po_email_rate_po') }, { status: 429 })

    const [{ data: shop }, { data: profile }] = await Promise.all([
      admin.from('shops').select('name, email, currency, country').eq('id', shop_id).single(),
      admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    ])
    const senderEmail = String(user.email || '').trim()
    const shopEmail = String(shop?.email || '').trim()
    const replyTo = EMAIL_RE.test(shopEmail) ? shopEmail : (EMAIL_RE.test(senderEmail) ? senderEmail : null)
    const copyTo = copy && EMAIL_RE.test(senderEmail) && senderEmail.toLowerCase() !== recipient.toLowerCase() ? senderEmail : null

    // Contenu : dans la langue de l'application au moment de l'envoi
    const tr = getLocaleTranslator(locale, 'emails') as any
    const tPo = (key: string, values?: Record<string, string | number>) => tr(`purchase_order.${key}`, values)
    const tUnit = getLocaleTranslator(locale, 'unit_labels') as any
    const unitLabel = (unit: string | null, n: number) =>
      !unit ? '' : (PRODUCT_UNITS as readonly string[]).includes(unit) ? tUnit(unit, { count: Math.abs(n) }) : unit
    const shopName = shop?.name || 'StockShop'
    const supplierName = po.suppliers?.name || ''
    const dateStr = formatDate(po.created_at, locale)
    const items = (po.purchase_order_items || []) as { product_name: string; unit: string | null; quantity_ordered: number; unit_price: number | null }[]
    const msg = buildPoMessage(tPo, {
      reference: po.reference, shopName, supplierName, dateStr, reorderOf: reorderOriginalRef(po.notes),
      lines: items.map(it => ({ name: it.product_name, quantity: `${it.quantity_ordered} ${unitLabel(it.unit, it.quantity_ordered)}`.trim() })),
    })

    // PDF : prix seulement avec le droit au coût (même règle que le téléchargement)
    const seesCost = await canViewCost(supabase, role, shop_id)
    const currency = resolveCurrencyCode(shop?.currency, shop?.country)
    const money = (v: number) => formatCurrency(v, currency)
    const { doc, fileName } = await buildPurchaseOrderDoc({
      shopName, reference: po.reference, dateStr, supplierName,
      supplierPhone: po.suppliers?.phone, supplierCity: po.suppliers?.city,
      items: items.map(it => ({
        name: it.product_name,
        quantity: it.quantity_ordered,
        unit: unitLabel(it.unit, it.quantity_ordered),
        unitPriceLabel: seesCost && it.unit_price != null ? money(it.unit_price) : '—',
        totalLabel: seesCost && it.unit_price != null ? money(it.unit_price * it.quantity_ordered) : '—',
      })),
      totalLabel: seesCost ? money(items.reduce((s, it) => s + (it.unit_price || 0) * it.quantity_ordered, 0)) : '—',
      labels: poPdfLabels(tPo),
    }, { logoBase64: await logoBase64(request) })
    const pdf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)

    const appUrl = appBaseUrl()
    const html = emailShell({
      appUrl,
      lang: locale,
      body: `
        <p style="margin:0 0 12px;font-size:15px;color:#111827;">${esc(msg.greeting)}</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#374151;">${esc(msg.intro)}</p>
        <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#073e8a;">${esc(msg.productsTitle)}</p>
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 14px;">
          ${items.map(it => `<tr>
            <td style="padding:6px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:#111827;">${esc(it.product_name)}</td>
            <td style="padding:6px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:#111827;text-align:right;white-space:nowrap;">${esc(`${it.quantity_ordered} ${unitLabel(it.unit, it.quantity_ordered)}`.trim())}</td>
          </tr>`).join('')}
        </table>
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">${esc(tPo('attachment'))}</p>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:#374151;">${esc(msg.confirm)}</p>
        <p style="margin:0 0 16px;font-size:14px;color:#374151;">${esc(msg.regards)}<br/><strong>${esc(shopName)}</strong></p>`,
      footer: `${replyTo ? esc(tPo('reply_hint', { shop: shopName })) + '<br/>' : ''}${esc(tPo('footer', { shop: shopName }))}`,
    })
    const text = `${msg.body}\n\n${tPo('attachment')}`

    const { data: sent, error: sendError } = await resend.emails.send({
      from: `${shopName.replace(/[<>"]/g, '').slice(0, 60)} via StockShop <${EMAIL_FROM.match(/<(.+)>/)?.[1] || 'no-reply@stockshop.tech'}>`,
      to: recipient,
      ...(copyTo ? { cc: copyTo } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: msg.subject,
      html, text,
      attachments: [{ filename: fileName, content: pdf }],
    } as any)

    const row = {
      purchase_order_id: id, shop_id, reference: po.reference, recipient, reply_to: replyTo, copy_to: copyTo, locale,
      status: sendError ? 'failed' : 'sent', error: sendError ? String(sendError.message || sendError).slice(0, 500) : null,
      provider_id: (sent as any)?.id ?? null, sent_by: user.id,
    }
    await admin.from('purchase_order_emails').insert(row)
    if (sendError) return NextResponse.json({ error: t('po_email_failed') }, { status: 502 })

    // Brouillon → Envoyé (décision B), écriture conditionnée : rien si le bon a changé entre-temps
    let statusChanged = false
    if (po.status === 'draft') {
      const now = new Date().toISOString()
      const result = await updatePoStatusAtomically(admin, { id, shopId: shop_id, from: 'draft', updates: { status: 'sent', updated_at: now, sent_at: now, sent_by: user.id } })
      statusChanged = !result.error && !result.conflict && !!result.data
    }
    await writeAuditLog({
      action: 'purchase_order.email',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: id,
      target_type: 'purchase_order',
      ip: getClientIp(request),
      metadata: { actor_name: profile?.full_name || user.email, reference: po.reference, recipient, status_changed: statusChanged },
    })
    return NextResponse.json({ ok: true, recipient, status_changed: statusChanged })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const url = new URL(request.url)
    const id = url.searchParams.get('id'), shop_id = url.searchParams.get('shop_id')
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canViewFeature(supabase, role, shop_id, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data: rows, error } = await admin
      .from('purchase_order_emails')
      .select('id, recipient, status, created_at, sent_by')
      .eq('purchase_order_id', id).eq('shop_id', shop_id)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const ids = Array.from(new Set((rows || []).map((r: any) => r.sent_by).filter(Boolean)))
    const { data: profiles } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
    const names = new Map((profiles || []).map((p: any) => [p.id, p.full_name]))
    return NextResponse.json({
      data: (rows || []).map((r: any) => ({ id: r.id, recipient: r.recipient, status: r.status, created_at: r.created_at, sent_by_name: names.get(r.sent_by) || null })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
