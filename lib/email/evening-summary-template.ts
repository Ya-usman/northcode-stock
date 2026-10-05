// Résumé de la journée — e-mail du soir au PROPRIÉTAIRE (option « Résumé
// quotidien » d'une boutique). UN e-mail par propriétaire, une section par
// boutique ayant l'option. Dans la langue du propriétaire (lib/email/i18n.ts).
// Même charte que les autres e-mails (brand.ts). Fonction pure (testable).

import { esc, emailShell } from './brand'
import { emailI18n, methodLabel, type EmailI18n } from './i18n'
import { formatCurrency } from '@/lib/utils/currency'
import type { ShopDay } from '@/lib/reports/evening-report'

const sectionTitle = (t: string) => `<p style="margin:18px 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">${esc(t)}</p>`
const tableOpen = `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;">`
const row = (left: string, right: string, strong = false) => `<tr>
  <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${left}</td>
  <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#0f172a;text-align:right;white-space:nowrap;${strong ? 'font-weight:700;' : ''}">${right}</td></tr>`
const muted = (s: string) => `<span style="color:#9ca3af;font-size:12px;">· ${esc(s)}</span>`
function tile(value: string, label: string, sub = '', tone: 'neutral' | 'warn' | 'good' = 'neutral'): string {
  const c = tone === 'warn' ? { bg: '#fffbeb', border: '#fde68a', v: '#b45309' } : tone === 'good' ? { bg: '#f0fdf4', border: '#bbf7d0', v: '#15803d' } : { bg: '#f8fafc', border: '#e5e7eb', v: '#0f172a' }
  return `<td width="50%" style="padding:4px;vertical-align:top;"><div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:12px 14px;">
    <div style="font-size:20px;font-weight:700;color:${c.v};line-height:1.2;">${value}</div>
    <div style="font-size:12px;color:#6b7280;margin-top:2px;">${esc(label)}</div>${sub ? `<div style="font-size:11px;margin-top:4px;">${sub}</div>` : ''}</div></td>`
}
const tiles = (cells: string[]) => {
  const rows: string[] = []
  for (let k = 0; k < cells.length; k += 2) rows.push(`<tr>${cells[k]}${cells[k + 1] ?? '<td width="50%"></td>'}</tr>`)
  return `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${rows.join('')}</table>`
}

/** Écart en % par rapport à une base (null si base nulle) */
export function trend(current: number, base: number): number | null {
  if (!(base > 0)) return null
  return Math.round(((current - base) / base) * 100)
}

/** La journée a-t-elle eu une activité ? (sinon : résumé court) */
export const hasActivity = (s: ShopDay) => s.salesCount > 0 || s.collected > 0 || s.expenses > 0 || s.cancelled.count > 0

function shopBlock(i: EmailI18n, s: ShopDay, appUrl: string, multi: boolean): string {
  const t = i.t
  const money = (n: number) => formatCurrency(Math.round(n), s.currency)
  const head = multi ? `<h2 style="margin:26px 0 2px;font-size:17px;color:#073e8a;">${esc(s.name)}</h2>` : ''
  if (!hasActivity(s)) {
    return `${head}<p style="margin:${multi ? '4px' : '16px'} 0 0;font-size:14px;color:#4b5563;">${esc(t('evening.no_activity'))}${s.totalDebt > 0 ? ` ${esc(t('evening.debts_pending', { amount: money(s.totalDebt) }))}` : ''}</p>`
  }
  const avg = s.salesCount ? s.revenue / s.salesCount : 0
  const cashFlow = s.collected - s.expenses
  const pct = trend(s.revenue, s.revenueLastWeek)
  const trendHtml = pct === null
    ? `<span style="color:#9ca3af;">— ${esc(t('evening.trend_week'))}</span>`
    : `<span style="color:${pct >= 0 ? '#15803d' : '#b91c1c'};font-weight:600;">${pct >= 0 ? '↑ +' : '↓ '}${pct} %</span> <span style="color:#9ca3af;">${esc(t('evening.trend_week'))}</span>`

  let b = head
  b += sectionTitle(t('evening.section_figures'))
  b += tiles([
    tile(money(s.revenue), t('evening.revenue_label', { count: s.salesCount }), trendHtml),
    tile(money(s.collected), t('evening.collected_label'), `<span style="color:#6b7280;">${esc(t('evening.avg_basket', { amount: money(avg) }))}</span>`, 'good'),
    tile(s.grossMargin === null ? '—' : money(s.grossMargin), t('evening.margin_label'), s.grossMargin === null
      ? `<span style="color:#9ca3af;">${esc(t('evening.margin_unknown'))}</span>`
      : s.marginCoverage < 0.95 ? `<span style="color:#9ca3af;">${esc(t('evening.margin_partial', { pct: Math.round(s.marginCoverage * 100) }))}</span>` : ''),
    tile(money(cashFlow), t('evening.cashflow_label'), `<span style="color:#6b7280;">${esc(t('evening.expenses_sub', { amount: money(s.expenses) }))}</span>`, cashFlow < 0 ? 'warn' : 'neutral'),
  ])

  if (s.byMethod.length) {
    b += sectionTitle(t('evening.section_methods'))
    b += tableOpen + s.byMethod.map(m => row(esc(methodLabel(i, m.method)), money(m.amount))).join('') + row(`<strong>${esc(t('evening.total_collected'))}</strong>`, money(s.collected), true) + '</table>'
  }

  if (s.creditSold > 0 || s.repayments > 0 || s.totalDebt > 0) {
    b += sectionTitle(t('evening.section_credit'))
    b += tableOpen
      + row(esc(t('evening.credit_sold')), money(s.creditSold))
      + row(esc(t('evening.repayments')), money(s.repayments))
      + row(`<strong>${esc(t('evening.total_debt'))}</strong>`, money(s.totalDebt), true) + '</table>'
  }

  if (s.topProducts.length) {
    b += sectionTitle(t('evening.section_top'))
    b += tableOpen + s.topProducts.map((p, k) => row(`${k + 1}. ${esc(p.name)} ${muted(t('evening.sold_qty', { count: p.quantity }))}`, money(p.amount))).join('') + '</table>'
  }

  if (s.sellers.length > 1 || s.discounts.count || s.cancelled.count) {
    b += sectionTitle(t('evening.section_team'))
    b += tableOpen
    if (s.sellers.length > 1) b += s.sellers.map(v => row(`${esc(v.name ?? t('evening.unknown_seller'))} ${muted(t('evening.sales_count', { count: v.count }))}`, money(v.amount))).join('')
    b += row(`${esc(t('evening.discounts'))} ${muted(t('evening.sales_count', { count: s.discounts.count }))}`, s.discounts.count ? money(s.discounts.amount) : '—')
    b += row(`${esc(t('evening.cancelled'))} ${muted(String(s.cancelled.count))}`, s.cancelled.count ? `<span style="color:#b91c1c;">${money(s.cancelled.amount)}</span>` : '—')
    b += '</table>'
  }

  if (s.stock.out || s.stock.low) {
    b += `<p style="margin:14px 0 0;font-size:13px;color:#b45309;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;">
      ${esc(t('evening.stock_line', { out: s.stock.out, low: s.stock.low }))} <a href="${appUrl}/${i.locale}/stock" style="color:#b45309;">${esc(t('evening.see_stock'))}</a></p>`
  }
  return b
}

export function buildEveningSummaryEmail(p: { ownerName: string | null; dateStr: string; shops: ShopDay[]; appUrl: string; i18n?: EmailI18n }): { subject: string; html: string } {
  const i = p.i18n ?? emailI18n('fr')
  const t = i.t
  const loc = i.locale
  const multi = p.shops.length > 1
  const active = p.shops.filter(hasActivity)
  // Objet : une seule devise → total ; sinon nombre de ventes (jamais de devises additionnées)
  const currencies = Array.from(new Set(p.shops.map(s => s.currency)))
  const sales = p.shops.reduce((n, s) => n + s.salesCount, 0)
  const total = currencies.length === 1 ? formatCurrency(Math.round(p.shops.reduce((n, s) => n + s.revenue, 0)), currencies[0]) : null
  const who = multi ? t('evening.shops_count', { count: p.shops.length }) : p.shops[0]?.name || ''
  const subject = !active.length ? t('evening.subject_none', { who })
    : total ? t('evening.subject_sales_total', { who, count: sales, total }) : t('evening.subject_sales', { who, count: sales })

  let overview = ''
  if (multi) {
    const th = (x: string, right = false) => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;background:#f8fafc;${right ? 'text-align:right;' : ''}">${esc(x)}</td>`
    overview = tableOpen + `<tr>${th(t('evening.col_shop'))}${th(t('evening.col_sales'), true)}</tr>`
      + p.shops.map(s => row(esc(s.name), `${i.num(s.salesCount)} · ${formatCurrency(Math.round(s.revenue), s.currency)}`)).join('')
      + currencies.map(c => {
        const sh = p.shops.filter(s => s.currency === c)
        const label = currencies.length > 1 ? t('evening.total_currency', { currency: c }) : t('evening.total')
        return row(`<strong>${esc(label)}</strong>`, `${i.num(sh.reduce((n, s) => n + s.salesCount, 0))} · ${formatCurrency(Math.round(sh.reduce((n, s) => n + s.revenue, 0)), c)}`, true)
      }).join('')
      + '</table>'
  }

  const body = `
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">${esc(t('evening.eyebrow', { date: p.dateStr }))}</p>
    <p style="margin:8px 0 0;font-size:15px;color:#1f2937;">${esc(p.ownerName ? t('evening.greeting', { name: p.ownerName }) : t('evening.greeting_anon'))}</p>
    <p style="margin:6px 0 0;font-size:15px;color:#1f2937;">${esc(multi ? t('evening.intro_multi') : t('evening.intro_one', { shop: p.shops[0]?.name || '' }))}</p>
    ${overview ? `<div style="margin-top:14px;">${overview}</div>` : ''}
    ${p.shops.map(s => shopBlock(i, s, p.appUrl, multi)).join('')}
    <p style="margin:24px 0 20px;text-align:center;"><a href="${p.appUrl}/${loc}/reports" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">${esc(t('evening.button'))}</a></p>`

  const footer = `${esc(t('evening.footer_reason', { shops: p.shops.map(s => s.name).join(', ') }))}<br/>
    ${esc(t('evening.footer_once'))} <a href="${p.appUrl}/${loc}/settings#notifications" style="color:#073e8a;">${esc(t('evening.manage'))}</a>`
  return { subject, html: emailShell({ appUrl: p.appUrl, body, footer, lang: loc }) }
}
