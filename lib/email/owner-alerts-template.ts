// E-mail quotidien d'alertes, UN par propriétaire, toutes ses boutiques
// regroupées (stock épuisé / faible, produits périmés / bientôt périmés).
// Envoyé seulement s'il y a au moins une alerte. Dans la langue du
// propriétaire (lib/email/i18n.ts). Fonction pure (testable).

import type { LowStockItem, ExpiryItem } from '@/lib/alerts/stock-alerts'
import { esc, emailShell } from './brand'
import { emailI18n, type EmailI18n } from './i18n'

export { brandHeader } from './brand'

export interface ShopAlerts {
  name: string
  outOfStock: LowStockItem[]
  lowStock: LowStockItem[]
  expired: ExpiryItem[]
  expiringSoon: ExpiryItem[]
}

const MAX_ROWS = 8

export function countAlerts(s: ShopAlerts): number {
  return s.outOfStock.length + s.lowStock.length + s.expired.length + s.expiringSoon.length
}

function rows<T>(i: EmailI18n, items: T[], color: string, bg: string, render: (x: T) => { name: string; badge: string }): string {
  const shown = items.slice(0, MAX_ROWS).map(x => {
    const r = render(x)
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${esc(r.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;"><span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">${esc(r.badge)}</span></td></tr>`
  }).join('')
  const more = items.length > MAX_ROWS ? `<tr><td colspan="2" style="padding:8px 12px;font-size:12px;color:#6b7280;">${esc(i.t('owner_alerts.more', { count: items.length - MAX_ROWS }))}</td></tr>` : ''
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:14px;">${shown}${more}</table>`
}

function section(title: string, color: string, body: string): string {
  return `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.5px;">${esc(title)}</p>${body}`
}

export function buildOwnerAlertsEmail(p: { ownerName: string | null; dateStr: string; shops: ShopAlerts[]; appUrl: string; i18n?: EmailI18n }): { subject: string; html: string; total: number } {
  const i = p.i18n ?? emailI18n('fr')
  const t = i.t
  const shops = p.shops.filter(s => countAlerts(s) > 0)
  const total = shops.reduce((n, s) => n + countAlerts(s), 0)
  const loc = i.locale
  const qty = (n: number, unit: string | null) => `${i.num(n)}${unit ? ` ${unit}` : ''}`
  const day = (d: string) => i.date(d + 'T12:00:00Z', { day: 'numeric', month: 'short', year: 'numeric' }, 'UTC')
  const subject = shops.length === 1
    ? t('owner_alerts.subject_one', { shop: shops[0].name, count: total })
    : t('owner_alerts.subject_multi', { shops: shops.length, count: total })

  const blocks = shops.map(s => {
    let b = `<h2 style="margin:22px 0 4px;font-size:16px;color:#073e8a;">${esc(s.name)}</h2>`
    if (s.outOfStock.length) b += section(t('owner_alerts.out_of_stock', { count: s.outOfStock.length }), '#b91c1c', rows(i, s.outOfStock, '#b91c1c', '#fee2e2', x => ({ name: x.name, badge: t('owner_alerts.badge_out') })))
    if (s.lowStock.length) b += section(t('owner_alerts.low_stock', { count: s.lowStock.length }), '#b45309', rows(i, s.lowStock, '#b45309', '#fef3c7', x => ({ name: x.name, badge: t('owner_alerts.badge_low', { qty: qty(x.quantity, x.unit), threshold: i.num(x.threshold) }) })))
    if (s.expired.length) b += section(t('owner_alerts.expired', { count: s.expired.length }), '#b91c1c', rows(i, s.expired, '#b91c1c', '#fee2e2', x => ({ name: x.name, badge: t('owner_alerts.badge_expired', { date: day(x.expiry_date), qty: qty(x.quantity, x.unit) }) })))
    if (s.expiringSoon.length) b += section(t('owner_alerts.expiring', { count: s.expiringSoon.length }), '#b45309', rows(i, s.expiringSoon, '#b45309', '#fef3c7', x => ({ name: x.name, badge: t('owner_alerts.badge_expiring', { date: day(x.expiry_date), qty: qty(x.quantity, x.unit) }) })))
    return b
  }).join('')

  const shopNames = shops.map(s => s.name).join(', ')
  const html = emailShell({
    appUrl: p.appUrl,
    lang: loc,
    body: `
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">${esc(t('owner_alerts.eyebrow', { date: p.dateStr }))}</p>
    <p style="margin:8px 0 0;font-size:15px;color:#1f2937;">${esc(p.ownerName ? t('owner_alerts.greeting', { name: p.ownerName }) : t('owner_alerts.greeting_anon'))}</p>
    <p style="margin:6px 0 0;font-size:15px;color:#1f2937;font-weight:600;">${esc(shops.length > 1 ? t('owner_alerts.attention_multi', { count: total, shops: shops.length }) : t('owner_alerts.attention', { count: total }))}</p>
    ${blocks}
    <p style="margin:18px 0 20px;text-align:center;"><a href="${p.appUrl}/${loc}/stock" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">${esc(t('owner_alerts.button'))}</a></p>`,
    footer: `${esc(t('owner_alerts.footer_reason', { shops: shopNames }))}<br/>
    ${esc(t('owner_alerts.footer_once'))} <a href="${p.appUrl}/${loc}/settings#notifications" style="color:#073e8a;">${esc(t('owner_alerts.manage'))}</a>`,
  })
  return { subject, html, total }
}
