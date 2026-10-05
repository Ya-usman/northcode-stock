// E-mails courts aux propriétaires : rappel de renouvellement d'abonnement et
// message urgent de l'équipe StockShop. Charte commune (brand.ts), langue du
// destinataire (i18n.ts). Fonctions pures (testables).

import { esc, emailShell } from './brand'
import type { EmailI18n } from './i18n'

const eyebrow = (s: string) => `<p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">${esc(s)}</p>`
const para = (s: string, extra = '') => `<p style="margin:8px 0 0;font-size:15px;color:#1f2937;line-height:1.5;${extra}">${s}</p>`
const button = (href: string, label: string) => `<p style="margin:22px 0 20px;text-align:center;"><a href="${href}" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">${esc(label)}</a></p>`

export function buildRenewalEmail(i: EmailI18n, p: { plan: string; appUrl: string }): { subject: string; html: string } {
  const t = i.t
  const body = eyebrow(t('renewal.eyebrow'))
    + para(esc(t('renewal.greeting')))
    + para(esc(t('renewal.body', { plan: p.plan })), 'font-weight:600;')
    + para(esc(t('renewal.body2')))
    + button(`${p.appUrl}/${i.locale}/billing`, t('renewal.button'))
  return { subject: t('renewal.subject', { plan: p.plan }), html: emailShell({ appUrl: p.appUrl, body, footer: esc(t('renewal.footer')), lang: i.locale }) }
}

export function buildUrgentEmail(i: EmailI18n, p: { shop: string | null; title: string; message: string; appUrl: string }): { subject: string; html: string } {
  const t = i.t
  const shop = p.shop || t('urgent.default_shop')
  const body = eyebrow(t('urgent.eyebrow'))
    + para(esc(t('urgent.greeting')))
    + para(esc(t('urgent.intro', { shop })))
    + `<div style="margin:12px 0 0;border-left:3px solid #dc2626;background:#fef2f2;border-radius:6px;padding:10px 14px;">
        <div style="font-size:15px;font-weight:700;color:#991b1b;">${esc(p.title)}</div>
        <div style="font-size:14px;color:#1f2937;margin-top:4px;white-space:pre-line;">${esc(p.message)}</div></div>`
    + button(`${p.appUrl}/${i.locale}/dashboard`, t('urgent.button'))
  return { subject: `🔴 ${p.title} — ${p.shop || 'StockShop'}`, html: emailShell({ appUrl: p.appUrl, body, footer: esc(t('urgent.footer')), lang: i.locale }) }
}

/** Texte des notifications push de stock (langue de l'appareil = celle de son utilisateur) */
export function lowStockPush(i: EmailI18n, shop: string, out: { name: string }[], low: { name: string; quantity: number }[]): { title: string; body: string } {
  const t = i.t
  const parts: string[] = []
  if (out.length === 1) parts.push(t('push.out_one', { name: out[0].name }))
  else if (out.length > 1) parts.push(t('push.out_many', { count: out.length }))
  if (low.length === 1) parts.push(t('push.low_one', { name: low[0].name, qty: i.num(low[0].quantity) }))
  else if (low.length > 1) parts.push(t('push.low_many', { count: low.length }))
  return { title: t('push.low_title', { shop }), body: parts.join(' ') }
}

export function expiryPush(i: EmailI18n, shop: string, expired: { name: string }[], soon: { name: string }[]): { title: string; body: string } {
  const t = i.t
  const parts: string[] = []
  if (expired.length === 1) parts.push(t('push.expired_one', { name: expired[0].name }))
  else if (expired.length > 1) parts.push(t('push.expired_many', { count: expired.length }))
  if (soon.length === 1) parts.push(t('push.expiring_one', { name: soon[0].name }))
  else if (soon.length > 1) parts.push(t('push.expiring_many', { count: soon.length }))
  return { title: t('push.expiry_title', { shop }), body: parts.join(' ') }
}
