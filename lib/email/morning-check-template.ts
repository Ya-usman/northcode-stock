// Bilan du matin — e-mail quotidien aux administrateurs de la plateforme.
// Même charte que les e-mails clients (lib/email/brand.ts). Fonction pure (testable).

import { esc, emailShell } from './brand'

export type ServiceStatus = 'ok' | 'disruption' | 'incident' | 'unknown'

export interface ServiceCheck {
  name: string
  status: ServiceStatus
  detail: string
  responseMs?: number
}

export interface ExpiringPlan { name: string; plan: string; expires_at: string }

export interface MorningCheckData {
  /** Date du jour, déjà mise en forme (ex. « mardi 6 octobre 2026 ») */
  date: string
  /** Heure de la vérification, déjà mise en forme (ex. « 8 h 00 ») */
  time: string
  services: ServiceCheck[]
  metrics: {
    newShops: number
    activeSaleShops: number
    totalSales: number
    /** Ventes en espèces enregistrées non payées dans les 24 h */
    unpaidSales: number
    totalShops: number
    totalUsers: number
  }
  expiringPlans: ExpiringPlan[]
  appUrl: string
}

const STATUS = {
  ok:         { label: 'Opérationnel', color: '#15803d', bg: '#dcfce7' },
  disruption: { label: 'Perturbé',     color: '#b45309', bg: '#fef3c7' },
  incident:   { label: 'Incident',     color: '#b91c1c', bg: '#fee2e2' },
  unknown:    { label: 'Inconnu',      color: '#4b5563', bg: '#f3f4f6' },
} as const

const fmtN = (n: number) => n.toLocaleString('fr-FR')
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000))

export function overallOf(services: ServiceCheck[]): { level: ServiceStatus; count: number } {
  const inc = services.filter(s => s.status === 'incident').length
  if (inc) return { level: 'incident', count: inc }
  const dis = services.filter(s => s.status === 'disruption').length
  if (dis) return { level: 'disruption', count: dis }
  return { level: 'ok', count: 0 }
}

function sectionTitle(t: string): string {
  return `<p style="margin:22px 0 8px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;">${t}</p>`
}

function tile(value: string, label: string, tone: 'neutral' | 'warn' = 'neutral'): string {
  const c = tone === 'warn' ? { bg: '#fffbeb', border: '#fde68a', value: '#b45309' } : { bg: '#f8fafc', border: '#e5e7eb', value: '#0f172a' }
  return `<td width="50%" style="padding:4px;vertical-align:top;">
    <div style="background:${c.bg};border:1px solid ${c.border};border-radius:10px;padding:12px 14px;">
      <div style="font-size:22px;font-weight:700;color:${c.value};line-height:1.2;">${value}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px;">${label}</div>
    </div></td>`
}

export function buildMorningCheckEmail(d: MorningCheckData): { subject: string; html: string } {
  const overall = overallOf(d.services)
  const s = STATUS[overall.level]
  const headline = overall.level === 'ok'
    ? 'Tous les services fonctionnent'
    : `${overall.level === 'incident' ? 'Incident' : 'Perturbation'} sur ${overall.count} service${overall.count > 1 ? 's' : ''}`
  const shortDate = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })
  const subject = overall.level === 'ok'
    ? `Bilan du ${shortDate} — tout fonctionne`
    : `[${overall.level === 'incident' ? 'Incident' : 'Perturbation'}] Bilan du ${shortDate} — ${headline.toLowerCase()}`

  const serviceRows = d.services.map(sv => {
    const st = STATUS[sv.status]
    const detail = sv.status !== 'ok' && sv.detail ? `<div style="font-size:12px;color:${st.color};margin-top:2px;">${esc(sv.detail)}</div>` : ''
    return `<tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${esc(sv.name)}${detail}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;">
        ${sv.responseMs !== undefined ? `<span style="font-size:12px;color:#9ca3af;margin-right:8px;">${fmtN(sv.responseMs)} ms</span>` : ''}
        <span style="display:inline-block;background:${st.bg};color:${st.color};font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">${st.label}</span>
      </td></tr>`
  }).join('')

  const m = d.metrics
  const watch: string[] = []
  for (const e of d.expiringPlans) {
    const n = daysLeft(e.expires_at)
    watch.push(`<tr><td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#1f2937;">${esc(e.name)} <span style="color:#9ca3af;font-size:12px;">· ${esc(e.plan)}</span></td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;text-align:right;white-space:nowrap;"><span style="display:inline-block;background:#fef3c7;color:#b45309;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">fin le ${fmtDay(e.expires_at)}${n <= 1 ? '' : ` · ${n} j`}</span></td></tr>`)
  }

  const body = `
    <p style="margin:0;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Bilan du matin · ${esc(d.date)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;background:${s.bg};border-radius:10px;"><tr>
      <td style="padding:14px 16px;">
        <div style="font-size:16px;font-weight:700;color:${s.color};">${headline}</div>
        <div style="font-size:12px;color:#4b5563;margin-top:2px;">Vérification automatique à ${esc(d.time)} (heure de Niamey)</div>
      </td></tr></table>

    ${sectionTitle('Services')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">${serviceRows}</table>

    ${sectionTitle('Activité des dernières 24 heures')}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px;"><tr>
      ${tile(fmtN(m.totalSales), `vente${m.totalSales > 1 ? 's' : ''} enregistrée${m.totalSales > 1 ? 's' : ''}`)}
      ${tile(`${fmtN(m.activeSaleShops)} <span style="font-size:13px;font-weight:600;color:#9ca3af;">/ ${fmtN(m.totalShops)}</span>`, 'boutiques ayant vendu')}
    </tr><tr>
      ${tile(fmtN(m.newShops), `nouvelle${m.newShops > 1 ? 's' : ''} boutique${m.newShops > 1 ? 's' : ''}`)}
      ${tile(fmtN(m.unpaidSales), 'ventes en espèces non payées', m.unpaidSales > 0 ? 'warn' : 'neutral')}
    </tr></table>
    <p style="margin:8px 0 0;font-size:12px;color:#9ca3af;">${fmtN(m.totalShops)} boutiques · ${fmtN(m.totalUsers)} comptes utilisateurs au total</p>

    ${watch.length ? `${sectionTitle(`À surveiller · abonnements qui se terminent sous 7 jours (${watch.length})`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;">${watch.join('')}</table>` : ''}

    <p style="margin:22px 0 20px;text-align:center;"><a href="${d.appUrl}/fr/admin" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;font-size:14px;">Ouvrir la console d'administration</a></p>`

  const footer = `Bilan envoyé chaque matin aux administrateurs StockShop.<br/>
    Historique des tâches automatiques : <a href="${d.appUrl}/fr/admin/system" style="color:#073e8a;">Admin → Système</a>`

  return { subject, html: emailShell({ appUrl: d.appUrl, body, footer }) }
}
