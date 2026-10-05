// Résumé de la journée — e-mail du soir au PROPRIÉTAIRE (option « Résumé
// quotidien » d'une boutique). UN e-mail par propriétaire, une section par
// boutique ayant l'option. Même charte que les autres e-mails (brand.ts).
// Fonction pure (testable).

import { esc, emailShell } from './brand'
import { formatCurrency } from '@/lib/utils/currency'
import type { ShopDay } from '@/lib/reports/evening-report'

const METHOD_LABEL: Record<string, string> = {
  cash: 'Espèces', mobile_money: 'Mobile Money', wave: 'Wave', transfer: 'Virement', pos: 'Carte / TPE',
  card: 'Carte', credit: 'Crédit', mixed: 'Paiement mixte', paystack: 'Paiement en ligne', other: 'Autre',
}
export const methodLabel = (m: string) => METHOD_LABEL[m] || m

const sectionTitle = (t: string) => `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">${t}</p>`
const tableOpen = `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;">`
const row = (left: string, right: string, strong = false) => `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${left}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;text-align:right;white-space:nowrap;${strong ? 'font-weight:700;' : ''}">${right}</td></tr>`
function tile(value: string, label: string, sub = '', tone: 'neutral' | 'warn' | 'good' = 'neutral'): string {
  const c = tone === 'warn' ? { bg: '#fffbeb', border: '#fde68a', v: '#b45309' } : tone === 'good' ? { bg: '#f0fdf4', border: '#bbf7d0', v: '#15803d' } : { bg: '#f8fafc', border: '#e5e7eb', v: '#0f172a' }
  return `<td width="50%" style="padding:4px;vertical-align:top;"><div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:12px 14px;">
    <div style="font-size:20px;font-weight:700;color:${c.v};line-height:1.2;">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>${sub ? `<div style="font-size:11px;margin-top:4px;">${sub}</div>` : ''}</div></td>`
}
const tiles = (cells: string[]) => {
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`)
  return `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${rows.join('')}</table>`
}

/** Écart en % par rapport à une base (null si base nulle) */
export function trend(current: number, base: number): number | null {
  if (!(base > 0)) return null
  return Math.round(((current - base) / base) * 100)
}
function trendText(pct: number | null): string {
  if (pct === null) return `<span style="color:#9ca3af;">— vs même jour la semaine dernière</span>`
  const up = pct >= 0
  return `<span style="color:${up ? '#15803d' : '#b91c1c'};font-weight:600;">${up ? '↑ +' : '↓ '}${pct} %</span> <span style="color:#9ca3af;">vs même jour la semaine dernière</span>`
}

/** La journée a-t-elle eu une activité ? (sinon : résumé court) */
export const hasActivity = (s: ShopDay) => s.salesCount > 0 || s.collected > 0 || s.expenses > 0 || s.cancelled.count > 0

function shopBlock(s: ShopDay, appUrl: string, multi: boolean): string {
  const money = (n: number) => formatCurrency(Math.round(n), s.currency)
  const head = multi ? `<h2 style="margin:26px 0 2px;font-size:17px;color:#073e8a;">${esc(s.name)}</h2>` : ''
  if (!hasActivity(s)) {
    return `${head}<p style="margin:${multi ? '4px' : '16px'} 0 0;font-size:14px;color:#4b5563;">Aucune vente ni dépense enregistrée aujourd'hui.${s.totalDebt > 0 ? ` Dettes clients en cours : <strong>${money(s.totalDebt)}</strong>.` : ''}</p>`
  }
  const avg = s.salesCount ? s.revenue / s.salesCount : 0
  const cashFlow = s.collected - s.expenses

  let b = head
  b += sectionTitle('Chiffres de la journée')
  b += tiles([
    tile(money(s.revenue), `chiffre d'affaires · ${s.salesCount} vente${s.salesCount > 1 ? 's' : ''}`, trendText(trend(s.revenue, s.revenueLastWeek))),
    tile(money(s.collected), 'encaissé aujourd\'hui', `<span style="color:#6b7280;">panier moyen ${money(avg)}</span>`, 'good'),
    tile(s.grossMargin === null ? '—' : money(s.grossMargin), 'marge brute', s.grossMargin === null
      ? '<span style="color:#9ca3af;">prix d\'achat non renseignés</span>'
      : s.marginCoverage < 0.95 ? `<span style="color:#9ca3af;">sur ${Math.round(s.marginCoverage * 100)} % des ventes (prix d'achat connus)</span>` : ''),
    tile(money(cashFlow), 'encaissé − dépenses', `<span style="color:#6b7280;">dépenses ${money(s.expenses)}</span>`, cashFlow < 0 ? 'warn' : 'neutral'),
  ])

  if (s.byMethod.length) {
    b += sectionTitle('Encaissements par mode de paiement')
    b += tableOpen + s.byMethod.map(m => row(esc(methodLabel(m.method)), money(m.amount))).join('') + row('<strong>Total encaissé</strong>', money(s.collected), true) + '</table>'
  }

  if (s.creditSold > 0 || s.repayments > 0 || s.totalDebt > 0) {
    b += sectionTitle('Crédit clients')
    b += tableOpen
      + row('Vendu à crédit aujourd\'hui', money(s.creditSold))
      + row('Dettes remboursées aujourd\'hui', money(s.repayments))
      + row('<strong>Total restant dû par les clients</strong>', money(s.totalDebt), true) + '</table>'
  }

  if (s.topProducts.length) {
    b += sectionTitle('Meilleures ventes')
    b += tableOpen + s.topProducts.map((p, i) => row(`${i + 1}. ${esc(p.name)} <span style="color:#9ca3af;font-size:12px;">· ${p.quantity.toLocaleString('fr-FR')} vendu${p.quantity > 1 ? 's' : ''}</span>`, money(p.amount))).join('') + '</table>'
  }

  if (s.sellers.length > 1 || s.discounts.count || s.cancelled.count) {
    b += sectionTitle('Équipe et contrôle')
    b += tableOpen
    if (s.sellers.length > 1) b += s.sellers.map(v => row(`${esc(v.name)} <span style="color:#9ca3af;font-size:12px;">· ${v.count} vente${v.count > 1 ? 's' : ''}</span>`, money(v.amount))).join('')
    b += row(`Remises accordées <span style="color:#9ca3af;font-size:12px;">· ${s.discounts.count} vente${s.discounts.count > 1 ? 's' : ''}</span>`, s.discounts.count ? money(s.discounts.amount) : '—')
    b += row(`Ventes annulées <span style="color:#9ca3af;font-size:12px;">· ${s.cancelled.count}</span>`, s.cancelled.count ? `<span style="color:#b91c1c;">${money(s.cancelled.amount)}</span>` : '—')
    b += '</table>'
  }

  if (s.stock.out || s.stock.low) {
    b += `<p style="margin:14px 0 0;font-size:13px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;">
      Stock : <strong>${s.stock.out}</strong> produit${s.stock.out > 1 ? 's' : ''} en rupture, <strong>${s.stock.low}</strong> en stock faible. <a href="${appUrl}/fr/stock" style="color:#b45309;">Voir le stock</a></p>`
  }
  return b
}

export function buildEveningSummaryEmail(p: { ownerName: string | null; dateStr: string; shops: ShopDay[]; appUrl: string }): { subject: string; html: string } {
  const multi = p.shops.length > 1
  const active = p.shops.filter(hasActivity)
  // Objet : le chiffre clé (une seule devise → total ; sinon nombre de ventes)
  const currencies = Array.from(new Set(p.shops.map(s => s.currency)))
  const sales = p.shops.reduce((n, s) => n + s.salesCount, 0)
  const total = currencies.length === 1 ? formatCurrency(Math.round(p.shops.reduce((n, s) => n + s.revenue, 0)), currencies[0]) : null
  const who = multi ? `${p.shops.length} boutiques` : p.shops[0]?.name || ''
  const subject = active.length
    ? `Votre journée — ${who} : ${sales} vente${sales > 1 ? 's' : ''}${total ? ` · ${total}` : ''}`
    : `Votre journée — ${who} : aucune vente aujourd'hui`

  // Vue d'ensemble multi-boutiques, par devise (jamais d'addition de devises différentes)
  let overview = ''
  if (multi) {
    overview = tableOpen + `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;background:#f8fafc;">Boutique</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:right;background:#f8fafc;">Ventes · CA</td></tr>`
      + p.shops.map(s => row(esc(s.name), `${s.salesCount} · ${formatCurrency(Math.round(s.revenue), s.currency)}`)).join('')
      + currencies.map(c => { const sh = p.shops.filter(s => s.currency === c); return row(`<strong>Total${currencies.length > 1 ? ` (${esc(c)})` : ''}</strong>`, `${sh.reduce((n, s) => n + s.salesCount, 0)} · ${formatCurrency(Math.round(sh.reduce((n, s) => n + s.revenue, 0)), c)}`, true) }).join('')
      + '</table>'
  }

  const body = `
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Résumé de la journée · ${esc(p.dateStr)}</p>
    <p style="margin:8px 0 0;font-size:15px;color:#1f2937;">Bonsoir${p.ownerName ? ' ' + esc(p.ownerName) : ''},</p>
    <p style="margin:6px 0 0;font-size:15px;color:#1f2937;">Voici le bilan de ${multi ? 'vos boutiques' : `<strong>${esc(p.shops[0]?.name || '')}</strong>`} pour aujourd'hui.</p>
    ${overview ? `<div style="margin-top:14px;">${overview}</div>` : ''}
    ${p.shops.map(s => shopBlock(s, p.appUrl, multi)).join('')}
    <p style="margin:24px 0 20px;text-align:center;"><a href="${p.appUrl}/fr/reports" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">Voir les rapports détaillés</a></p>`

  const footer = `Vous recevez ce résumé car l'option « Résumé quotidien » est activée pour : ${p.shops.map(s => esc(s.name)).join(', ')}.<br/>
    Un e-mail par soir, uniquement les jours d'activité. <a href="${p.appUrl}/fr/settings#notifications" style="color:#073e8a;">Gérer mes e-mails</a>`
  return { subject, html: emailShell({ appUrl: p.appUrl, body, footer }) }
}
