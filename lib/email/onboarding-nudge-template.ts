// Relances « Bien démarrer » (J+1, J+3, J+7) — charte commune (brand.ts),
// langue du propriétaire (i18n.ts). Le bouton ouvre l'app directement dans
// le tour guidé concerné (?tour=…). Pied : désinscription en un clic.
// Fonction pure (testable).

import { esc, emailShell } from './brand'
import type { EmailI18n } from './i18n'
import type { NudgeId, NudgeVariant } from '@/lib/onboarding/nudges'

const eyebrow = (s: string) => `<p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">${esc(s)}</p>`
const para = (s: string, extra = '') => `<p style="margin:10px 0 0;font-size:15px;color:#1f2937;line-height:1.55;${extra}">${s}</p>`
const button = (href: string, label: string) => `<p style="margin:22px 0 18px;text-align:center;"><a href="${href}" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">${esc(label)}</a></p>`
const steps = (items: string[]) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 0;width:100%;">${items.map((s, i) => `
  <tr><td style="width:28px;vertical-align:top;padding:4px 0;"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:#e8f0fb;color:#073e8a;font-size:12px;font-weight:700;text-align:center;">${i + 1}</span></td>
  <td style="padding:5px 0 5px 6px;font-size:14px;color:#374151;line-height:1.45;">${esc(s)}</td></tr>`).join('')}</table>`

export interface NudgeEmailInput {
  nudge: NudgeId
  variant: NudgeVariant
  ownerName: string | null
  shopName: string | null
  appUrl: string
  unsubscribeUrl: string
  /** Contact facultatif (variables SUPPORT_EMAIL / SUPPORT_WHATSAPP) */
  supportEmail?: string | null
  supportWhatsApp?: string | null
}

export function buildOnboardingNudgeEmail(i: EmailI18n, p: NudgeEmailInput): { subject: string; html: string; text: string } {
  const t = (k: string, v?: Record<string, string | number>) => i.t(`onboarding.${k}`, v)
  const shop = p.shopName || 'StockShop'
  const hello = p.ownerName ? t('greeting_name', { name: p.ownerName.split(' ')[0] }) : t('greeting')
  const base = `${p.appUrl}/${i.locale}`
  let key: string, href: string, list: string[] = [], extra = ''

  if (p.nudge === 'd7') {
    key = 'd7'
    href = `${base}/dashboard?guide=1`
    const contacts = [
      t('d7_contact_chat'),
      p.supportWhatsApp ? t('d7_contact_whatsapp', { number: p.supportWhatsApp }) : null,
      p.supportEmail ? t('d7_contact_email', { email: p.supportEmail }) : null,
    ].filter(Boolean) as string[]
    extra = `<div style="margin:14px 0 0;border-radius:10px;background:#f4f6fb;padding:12px 14px;font-size:14px;color:#374151;line-height:1.5;">${contacts.map(c => `<div>• ${esc(c)}</div>`).join('')}</div>`
  } else if (p.variant === 'sale') {
    key = `${p.nudge}_sale`
    href = `${base}/sales/new?tour=first_sale`
    list = [t('sale_step1'), t('sale_step2'), t('sale_step3')]
  } else {
    key = `${p.nudge}_product`
    href = `${base}/stock/products?tour=add_product`
    list = [t('product_step1'), t('product_step2'), t('product_step3')]
  }

  const body = eyebrow(t('eyebrow'))
    + para(esc(hello))
    + para(esc(t(`${key}.intro`, { shop })))
    + (list.length ? steps(list) : '')
    + extra
    + button(href, t(`${key}.button`))
    + (p.nudge !== 'd7' && p.variant === 'product' ? para(esc(t('import_hint')), 'font-size:13px;color:#6b7280;margin-top:0;text-align:center;') : '')
  const footer = `${esc(t('footer_reason'))}<br/><a href="${p.unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">${esc(t('unsubscribe'))}</a>`
  const subject = t(`${key}.subject`, { shop })
  const text = [hello, t(`${key}.intro`, { shop }), ...list.map((s, n) => `${n + 1}. ${s}`), `${t(`${key}.button`)} : ${href}`, '', `${t('unsubscribe')} : ${p.unsubscribeUrl}`].join('\n')
  return { subject, html: emailShell({ appUrl: p.appUrl, body, footer, lang: i.locale }), text }
}
