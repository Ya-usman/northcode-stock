// Bilan du matin — e-mail quotidien aux administrateurs de la plateforme.
// Même charte que les e-mails clients (lib/email/brand.ts). Fonction pure (testable).
// Ordre : état général → services → tâches automatiques → activité clients →
// abonnements (revenu StockShop) → clients à surveiller.

import { esc, emailShell } from './brand'
import { formatCurrency } from '@/lib/utils/currency'

export type ServiceStatus = 'ok' | 'disruption' | 'incident' | 'unknown'
export interface ServiceCheck { name: string; status: ServiceStatus; detail: string; responseMs?: number }
export interface ExpiringPlan { name: string; plan: string; expires_at: string }
export interface JobState { label: string; status: 'ok' | 'error' | 'missing' | 'paused'; at?: string; error?: string }

export interface MorningReport {
  /** Date et heure déjà mises en forme (heure de Paris) */
  date: string
  time: string
  env: string
  appUrl: string
  contactEmail: string
  services: ServiceCheck[]
  jobs: JobState[]
  metrics: {
    newShops: number
    activeSaleShops: number
    totalSales: number
    /** Ventes en espèces enregistrées non payées dans les 24 h */
    unpaidSales: number
    totalShops: number
    totalUsers: number
    newUsers: number
    newEntities: number
  }
  revenue: { currency: string; last24: number; prev24: number; avg7: number; missing: string[] }
  billing: { payments24: number; amount24: number; newPaid24: number; trialsActive: number; trialsEnding: { name: string; ends_at: string }[] }
  expiringPlans: ExpiringPlan[]
  silentShops: string[]
}

/** Fuseau des administrateurs (en France) — le bilan leur est destiné ; les e-mails clients gardent le fuseau africain */
export const ADMIN_TZ = 'Europe/Paris'
export const ADMIN_TZ_LABEL = 'heure de Paris'

const STATUS = {
  ok:         { label: 'Opérationnel', color: '#15803d', bg: '#dcfce7', icon: '✓' },
  disruption: { label: 'Perturbé',     color: '#b45309', bg: '#fef3c7', icon: '!' },
  incident:   { label: 'Incident',     color: '#b91c1c', bg: '#fee2e2', icon: '✕' },
  unknown:    { label: 'Inconnu',      color: '#4b5563', bg: '#f3f4f6', icon: '?' },
} as const
const JOB = {
  ok:      { label: 'Réussie',      color: '#15803d', bg: '#dcfce7' },
  error:   { label: 'En erreur',    color: '#b91c1c', bg: '#fee2e2' },
  missing: { label: 'Pas exécutée', color: '#b45309', bg: '#fef3c7' },
  paused:  { label: 'En pause',     color: '#4b5563', bg: '#f3f4f6' },
} as const

const fmtN = (n: number) => Math.round(n).toLocaleString('fr-FR')
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: ADMIN_TZ })
const fmtHour = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ADMIN_TZ }).replace(':', ' h ')
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))
const pill = (text: string, color: string, bg: string) => `<span style="display:inline-block;background:${bg};color:${color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;">${esc(text)}</span>`

export function overallOf(services: ServiceCheck[]): { level: ServiceStatus; count: number } {
  const inc = services.filter(s => s.status === 'incident').length
  if (inc) return { level: 'incident', count: inc }
  const dis = services.filter(s => s.status === 'disruption').length
  if (dis) return { level: 'disruption', count: dis }
  return { level: 'ok', count: 0 }
}

/** Écart en % (null si la base est nulle) */
export function trend(current: number, base: number): number | null {
  if (!(base > 0)) return null
  return Math.round(((current - base) / base) * 100)
}

function trendText(pct: number | null, label: string): string {
  if (pct === null) return `<span style="color:#9ca3af;">— ${label}</span>`
  const up = pct >= 0
  return `<span style="color:${up ? '#15803d' : '#b91c1c'};font-weight:600;">${up ? '↑' : '↓'} ${up ? '+' : ''}${pct} %</span> <span style="color:#9ca3af;">${label}</span>`
}

const sectionTitle = (t: string) => `<p style="margin:24px 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">${t}</p>`
const tableOpen = `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;">`
const th = (t: string, align = 'left') => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;text-align:${align};background:#f8fafc;">${t}</td>`
const td = (html: string, align = 'left', extra = '') => `<td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;text-align:${align};${extra}">${html}</td>`

function tile(value: string, label: string, sub = '', tone: 'neutral' | 'warn' = 'neutral'): string {
  const c = tone === 'warn' ? { bg: '#fffbeb', border: '#fde68a', value: '#b45309' } : { bg: '#f8fafc', border: '#e5e7eb', value: '#0f172a' }
  return `<td width="50%" style="padding:4px;vertical-align:top;">
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:12px 14px;">
      <div style="font-size:21px;font-weight:700;color:${c.value};line-height:1.2;">${value}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>
      ${sub ? `<div style="font-size:11px;margin-top:4px;">${sub}</div>` : ''}
    </div></td>`
}
const tiles = (cells: string[]) => {
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += 2) rows.push(`<tr>${cells[i]}${cells[i + 1] ?? '<td width="50%"></td>'}</tr>`)
  return `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;">${rows.join('')}</table>`
}

export function buildMorningCheckEmail(d: MorningReport): { subject: string; html: string } {
  const overall = overallOf(d.services)
  const s = STATUS[overall.level]
  const jobErrors = d.jobs.filter(j => j.status === 'error' || j.status === 'missing')
  const headline = overall.level === 'ok'
    ? 'Tous les services fonctionnent'
    : `${overall.level === 'incident' ? 'Incident' : 'Perturbation'} sur ${overall.count} service${overall.count > 1 ? 's' : ''}`
  const shortDate = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: ADMIN_TZ })
  const jobNote = jobErrors.length ? `${jobErrors.length} tâche${jobErrors.length > 1 ? 's' : ''} à vérifier` : ''
  const subject = overall.level !== 'ok'
    ? `[${overall.level === 'incident' ? 'Incident' : 'Perturbation'}] Bilan du ${shortDate} — ${headline.toLowerCase()}`
    : jobErrors.length ? `[À vérifier] Bilan du ${shortDate} — ${jobNote}` : `Bilan du ${shortDate} — tout fonctionne`
  const money = (n: number) => formatCurrency(Math.round(n), d.revenue.currency)

  // ── Services ──
  const services = d.services.map(sv => {
    const st = STATUS[sv.status]
    const detail = sv.status !== 'ok' && sv.detail ? `<div style="font-size:12px;color:${st.color};margin-top:2px;word-break:break-word;overflow-wrap:anywhere;">${esc(sv.detail)}</div>` : ''
    return `<tr>${td(esc(sv.name) + detail)}${td(sv.responseMs !== undefined ? `<span style="font-size:12px;color:#6b7280;">${fmtN(sv.responseMs)} ms</span>` : '—', 'right', 'white-space:nowrap;')}${td(pill(st.label, st.color, st.bg), 'right')}</tr>`
  }).join('')

  // ── Tâches automatiques ──
  const jobs = d.jobs.map(j => {
    const st = JOB[j.status]
    const when = j.at ? `<span style="font-size:12px;color:#6b7280;">${fmtHour(j.at)}</span>` : '—'
    const err = j.status === 'error' && j.error ? `<div style="font-size:12px;color:#b91c1c;margin-top:2px;word-break:break-word;overflow-wrap:anywhere;">${esc(j.error)}</div>` : ''
    return `<tr>${td(esc(j.label) + err)}${td(when, 'right', 'white-space:nowrap;')}${td(pill(st.label, st.color, st.bg), 'right')}</tr>`
  }).join('')

  const m = d.metrics, r = d.revenue, b = d.billing
  const list = (rows: string[]) => rows.length ? `${tableOpen}${rows.join('')}</table>` : ''

  const body = `
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Bilan du matin · ${esc(d.env)} · ${esc(d.date)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${s.bg};border-radius:10px;"><tr>
      <td width="44" style="padding:14px 0 14px 16px;vertical-align:middle;">
        <div style="width:32px;height:32px;line-height:32px;border-radius:16px;background:${s.color};color:#fff;font-size:17px;font-weight:700;text-align:center;">${s.icon}</div>
      </td>
      <td style="padding:14px 16px 14px 10px;vertical-align:middle;">
        <div style="font-size:16px;font-weight:700;color:${s.color};">${headline}</div>
        <div style="font-size:12px;color:#4b5563;margin-top:2px;">Vérification automatique à ${esc(d.time)} (${ADMIN_TZ_LABEL})${jobNote ? ` · <strong style="color:#b45309;">${jobNote}</strong>` : ''}</div>
      </td></tr></table>

    ${sectionTitle('Services')}
    ${tableOpen}<tr>${th('Service')}${th('Réponse', 'right')}${th('État', 'right')}</tr>${services}</table>
    <p style="margin:8px 0 0;font-size:11px;color:#6b7280;line-height:1.6;">
      ${pill('Opérationnel', STATUS.ok.color, STATUS.ok.bg)} aucun problème &nbsp;
      ${pill('Perturbé', STATUS.disruption.color, STATUS.disruption.bg)} lent, sans impact pour les clients &nbsp;
      ${pill('Incident', STATUS.incident.color, STATUS.incident.bg)} clients touchés
    </p>

    ${sectionTitle(`Tâches automatiques des dernières 24 heures${jobErrors.length ? ` · ${jobNote}` : ''}`)}
    ${tableOpen}<tr>${th('Tâche')}${th('Heure', 'right')}${th('État', 'right')}</tr>${jobs}</table>

    ${sectionTitle('Activité des clients · dernières 24 heures')}
    ${tiles([
      tile(money(r.last24), `chiffre d'affaires des boutiques (converti en ${esc(r.currency)})`, `${trendText(trend(r.last24, r.prev24), 'vs la veille')}<br/>${trendText(trend(r.last24, r.avg7), 'vs moyenne 7 jours')}`),
      tile(fmtN(m.totalSales), `vente${m.totalSales > 1 ? 's' : ''} enregistrée${m.totalSales > 1 ? 's' : ''}`, `<span style="color:#6b7280;">dans ${fmtN(m.activeSaleShops)} boutique${m.activeSaleShops > 1 ? 's' : ''} sur ${fmtN(m.totalShops)}</span>`),
      tile(`${fmtN(m.newUsers)} · ${fmtN(m.newEntities)}`, 'nouveaux comptes · nouvelles entreprises', m.newShops ? `<span style="color:#6b7280;">${fmtN(m.newShops)} nouvelle${m.newShops > 1 ? 's' : ''} boutique${m.newShops > 1 ? 's' : ''}</span>` : ''),
      tile(fmtN(m.unpaidSales), 'ventes en espèces non payées', '', m.unpaidSales > 0 ? 'warn' : 'neutral'),
    ])}
    ${r.missing.length ? `<p style="margin:6px 0 0;font-size:11px;color:#b45309;">Sans taux de change, non comptées : ${esc(r.missing.join(', '))}</p>` : ''}

    ${sectionTitle('Abonnements StockShop')}
    ${tiles([
      tile(money(b.amount24), `encaissé en 24 h · ${fmtN(b.payments24)} paiement${b.payments24 > 1 ? 's' : ''}`),
      tile(fmtN(b.newPaid24), `nouvel${b.newPaid24 > 1 ? 's' : ''} abonné${b.newPaid24 > 1 ? 's' : ''} payant${b.newPaid24 > 1 ? 's' : ''}`, `<span style="color:#6b7280;">${fmtN(b.trialsActive)} entreprise${b.trialsActive > 1 ? 's' : ''} en essai</span>`),
    ])}
    ${b.trialsEnding.length ? `<p style="margin:12px 0 6px;font-size:13px;font-weight:600;color:#1f2937;">Essais qui se terminent sous 3 jours (${b.trialsEnding.length})</p>
    ${list(b.trialsEnding.map(e => `<tr>${td(esc(e.name))}${td(pill(`fin le ${fmtDay(e.ends_at)}`, '#1d4ed8', '#dbeafe'), 'right')}</tr>`))}` : ''}
    ${d.expiringPlans.length ? `<p style="margin:12px 0 6px;font-size:13px;font-weight:600;color:#1f2937;">Abonnements payants qui se terminent sous 7 jours (${d.expiringPlans.length})</p>
    ${list(d.expiringPlans.map(e => { const n = daysLeft(e.expires_at); return `<tr>${td(`${esc(e.name)} <span style="color:#9ca3af;font-size:12px;">· ${esc(e.plan)}</span>`)}${td(pill(`fin le ${fmtDay(e.expires_at)}${n <= 1 ? '' : ` · ${n} j`}`, '#b45309', '#fef3c7'), 'right')}</tr>` }))}` : ''}

    ${d.silentShops.length ? `${sectionTitle(`Clients à surveiller · aucune vente depuis 7 jours (${d.silentShops.length})`)}
    <p style="margin:0;font-size:14px;color:#1f2937;line-height:1.6;">${esc(d.silentShops.slice(0, 5).join(', '))}${d.silentShops.length > 5 ? ` <span style="color:#6b7280;">et ${d.silentShops.length - 5} autre${d.silentShops.length - 5 > 1 ? 's' : ''}</span>` : ''}</p>
    <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Un appel ou un message peut éviter un départ.</p>` : ''}

    <p style="margin:24px 0 20px;text-align:center;"><a href="${d.appUrl}/fr/admin" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">Ouvrir la console d'administration</a></p>`

  const footer = `Bilan envoyé chaque matin aux administrateurs StockShop.<br/>
    Historique des tâches : <a href="${d.appUrl}/fr/admin/system" style="color:#073e8a;">Admin → Système</a> · Équipe technique : <a href="mailto:${esc(d.contactEmail)}" style="color:#073e8a;">${esc(d.contactEmail)}</a>`

  return { subject, html: emailShell({ appUrl: d.appUrl, body, footer }) }
}
