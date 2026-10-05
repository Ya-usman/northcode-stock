// E-mail quotidien d'alertes, UN par propriétaire, toutes ses boutiques
// regroupées (stock épuisé / faible, produits périmés / bientôt périmés).
// Envoyé seulement s'il y a au moins une alerte. Fonction pure (testable).

import type { LowStockItem, ExpiryItem } from '@/lib/alerts/stock-alerts'

export interface ShopAlerts {
  name: string
  outOfStock: LowStockItem[]
  lowStock: LowStockItem[]
  expired: ExpiryItem[]
  expiringSoon: ExpiryItem[]
}

const MAX_ROWS = 8
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * Marque en tête d'e-mail : cercle « S » à gauche du nom, comme BrandLogo
 * (icône ≈ 1,6 × la taille du texte, écart ≈ 0,3 em, Montserrat 700 -0,04 em).
 * PNG hébergé (Gmail n'affiche pas le SVG) ; tableau pour l'alignement
 * vertical dans tous les clients de messagerie.
 */
export function brandHeader(appUrl: string): string {
  return `<table cellpadding="0" cellspacing="0" role="presentation"><tr>
    <td style="vertical-align:middle;padding-right:6px;"><img src="${appUrl}/brand/stockshop-icon.png" width="29" height="29" alt="" style="display:block;width:29px;height:29px;border:0;" /></td>
    <td style="vertical-align:middle;font-family:Montserrat,'Segoe UI',Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.04em;color:#073e8a;line-height:1;">StockShop</td>
  </tr></table>`
}

export function countAlerts(s: ShopAlerts): number {
  return s.outOfStock.length + s.lowStock.length + s.expired.length + s.expiringSoon.length
}

function rows<T>(items: T[], color: string, bg: string, render: (i: T) => { name: string; badge: string }): string {
  const shown = items.slice(0, MAX_ROWS).map(i => {
    const r = render(i)
    return `<tr><td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${esc(r.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;"><span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">${esc(r.badge)}</span></td></tr>`
  }).join('')
  const more = items.length > MAX_ROWS ? `<tr><td colspan="2" style="padding:8px 12px;font-size:12px;color:#6b7280;">+ ${items.length - MAX_ROWS} autre(s)</td></tr>` : ''
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:14px;">${shown}${more}</table>`
}

function section(title: string, color: string, body: string): string {
  return `<p style="margin:14px 0 6px;font-size:12px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:0.5px;">${title}</p>${body}`
}

export function buildOwnerAlertsEmail(p: { ownerName: string | null; dateStr: string; shops: ShopAlerts[]; appUrl: string; locale?: string }): { subject: string; html: string; total: number } {
  const shops = p.shops.filter(s => countAlerts(s) > 0)
  const total = shops.reduce((n, s) => n + countAlerts(s), 0)
  const loc = p.locale || 'fr'
  const subject = shops.length === 1
    ? `Alertes de stock — ${shops[0].name} (${total} produit${total > 1 ? 's' : ''})`
    : `Alertes de stock — ${shops.length} boutiques (${total} produit${total > 1 ? 's' : ''})`

  const blocks = shops.map(s => {
    let b = `<h2 style="margin:22px 0 4px;font-size:16px;color:#073e8a;">${esc(s.name)}</h2>`
    if (s.outOfStock.length) b += section(`Rupture de stock (${s.outOfStock.length})`, '#b91c1c', rows(s.outOfStock, '#b91c1c', '#fee2e2', i => ({ name: i.name, badge: 'épuisé' })))
    if (s.lowStock.length) b += section(`Stock faible (${s.lowStock.length})`, '#b45309', rows(s.lowStock, '#b45309', '#fef3c7', i => ({ name: i.name, badge: `${i.quantity} ${i.unit ?? ''} · seuil ${i.threshold}`.replace(/\s+·/, ' ·') })))
    if (s.expired.length) b += section(`Déjà périmés (${s.expired.length})`, '#b91c1c', rows(s.expired, '#b91c1c', '#fee2e2', i => ({ name: i.name, badge: `périmé le ${fmtDay(i.expiry_date)} · ${i.quantity} ${i.unit ?? ''}`.trim() })))
    if (s.expiringSoon.length) b += section(`Bientôt périmés (${s.expiringSoon.length})`, '#b45309', rows(s.expiringSoon, '#b45309', '#fef3c7', i => ({ name: i.name, badge: `le ${fmtDay(i.expiry_date)} · ${i.quantity} ${i.unit ?? ''}`.trim() })))
    return b
  }).join('')

  const shopNames = shops.map(s => esc(s.name)).join(', ')
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap" rel="stylesheet"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:28px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 4px 14px;">${brandHeader(p.appUrl)}</td></tr>
  <tr><td style="background:#fff;border-radius:14px;padding:24px 24px 8px;box-shadow:0 2px 12px rgba(7,62,138,0.06);">
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Alertes du ${esc(p.dateStr)}</p>
    <p style="margin:8px 0 0;font-size:15px;color:#1f2937;">Bonjour${p.ownerName ? ' ' + esc(p.ownerName) : ''},</p>
    <p style="margin:6px 0 0;font-size:15px;color:#1f2937;"><strong>${total} produit${total > 1 ? 's' : ''}</strong> demande${total > 1 ? 'nt' : ''} votre attention${shops.length > 1 ? ` dans ${shops.length} boutiques` : ''}.</p>
    ${blocks}
    <p style="margin:18px 0 20px;text-align:center;"><a href="${p.appUrl}/${loc}/stock" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">Ouvrir le stock</a></p>
  </td></tr>
  <tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">
    Vous recevez cet e-mail car les alertes de stock par e-mail sont activées pour : ${shopNames}.<br/>
    Un seul e-mail par jour, uniquement s'il y a une alerte. <a href="${p.appUrl}/${loc}/settings#notifications" style="color:#073e8a;">Gérer mes alertes</a>
  </td></tr>
</table></td></tr></table>
</body></html>`
  return { subject, html, total }
}
