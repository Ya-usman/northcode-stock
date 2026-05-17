export type ServiceStatus = 'ok' | 'disruption' | 'incident' | 'unknown'

export interface ServiceCheck {
  name: string
  status: ServiceStatus
  detail: string
  responseMs?: number
}

export interface MorningCheckData {
  date: string
  services: ServiceCheck[]
  metrics: {
    newShops: number
    activeSaleShops: number
    totalSales: number
    totalRevenue: number
    failedPayments: number
    expiringPlans: number
    totalShops: number
    totalUsers: number
  }
  hasIncident: boolean
  hasDisruption: boolean
}

function statusIcon(status: ServiceStatus): string {
  switch (status) {
    case 'ok':         return '&#9728;&#65039;'  // ☀️
    case 'disruption': return '&#127746;'         // 🌦️
    case 'incident':   return '&#9928;&#65039;'   // ⛈️
    default:           return '&#10067;'           // ❓
  }
}

function statusColor(status: ServiceStatus): string {
  switch (status) {
    case 'ok':         return '#16a34a'
    case 'disruption': return '#d97706'
    case 'incident':   return '#dc2626'
    default:           return '#6b7280'
  }
}

function statusBg(status: ServiceStatus): string {
  switch (status) {
    case 'ok':         return '#f0fdf4'
    case 'disruption': return '#fffbeb'
    case 'incident':   return '#fef2f2'
    default:           return '#f9fafb'
  }
}

function statusLabel(status: ServiceStatus): string {
  switch (status) {
    case 'ok':         return 'No issues reported.'
    case 'disruption': return 'Disruption without impact'
    case 'incident':   return 'Incident in progress'
    default:           return 'Status unknown'
  }
}

function overallStatus(data: MorningCheckData): { label: string; color: string; icon: string } {
  if (data.hasIncident)   return { label: 'INCIDENT EN COURS', color: '#dc2626', icon: '&#9928;&#65039;' }
  if (data.hasDisruption) return { label: 'PERTURBATION', color: '#d97706', icon: '&#127746;' }
  return { label: 'TOUS LES SYSTÈMES OPÉRATIONNELS', color: '#16a34a', icon: '&#9728;&#65039;' }
}

export function buildMorningCheckHtml(data: MorningCheckData): string {
  const overall = overallStatus(data)

  const serviceRows = data.services.map(s => `
    <tr style="background:${statusBg(s.status)}">
      <td style="padding:10px 16px;font-size:14px;color:#111827;border-bottom:1px solid #e5e7eb;">${s.name}</td>
      <td style="padding:10px 16px;font-size:13px;color:${statusColor(s.status)};border-bottom:1px solid #e5e7eb;">${statusLabel(s.status)}</td>
      <td style="padding:10px 16px;text-align:center;border-bottom:1px solid #e5e7eb;font-size:18px;">${statusIcon(s.status)}</td>
      ${s.responseMs !== undefined
        ? `<td style="padding:10px 16px;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">${s.responseMs}ms</td>`
        : `<td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;"></td>`}
    </tr>
  `).join('')

  const fmtNumber = (n: number) => n.toLocaleString('fr-FR')

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
  <tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr style="background:#073e8a;">
        <td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="color:#93c5fd;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px;">StockShop Platform</div>
                <div style="color:#ffffff;font-size:20px;font-weight:700;">Daily Morning Check</div>
                <div style="color:#bfdbfe;font-size:13px;margin-top:4px;">${data.date} &mdash; 07:00 WAT</div>
              </td>
              <td align="right">
                <div style="font-size:36px;">${overall.icon}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Overall status banner -->
      <tr style="background:${overall.color};">
        <td style="padding:12px 32px;text-align:center;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:1px;">
          ${overall.label}
        </td>
      </tr>

      <!-- Service table -->
      <tr><td style="padding:24px 32px 0;">
        <div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">État des services — IT Production</div>
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">SERVICE</th>
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">STATUT</th>
              <th style="padding:10px 16px;text-align:center;font-size:12px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">&#9728;&#65039;</th>
              <th style="padding:10px 16px;text-align:left;font-size:12px;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">LATENCE</th>
            </tr>
          </thead>
          <tbody>${serviceRows}</tbody>
        </table>
      </td></tr>

      <!-- Metrics -->
      <tr><td style="padding:24px 32px 0;">
        <div style="font-size:13px;font-weight:700;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:12px;">Activité des dernières 24h</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="50%" style="padding-right:8px;padding-bottom:12px;">
              <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:#16a34a;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Nouvelles boutiques</div>
                <div style="font-size:28px;font-weight:700;color:#111827;margin-top:4px;">${fmtNumber(data.metrics.newShops)}</div>
              </div>
            </td>
            <td width="50%" style="padding-left:8px;padding-bottom:12px;">
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:#1d4ed8;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Boutiques actives</div>
                <div style="font-size:28px;font-weight:700;color:#111827;margin-top:4px;">${fmtNumber(data.metrics.activeSaleShops)} <span style="font-size:13px;color:#6b7280;">/ ${fmtNumber(data.metrics.totalShops)}</span></div>
              </div>
            </td>
          </tr>
          <tr>
            <td width="50%" style="padding-right:8px;padding-bottom:12px;">
              <div style="background:#fefce8;border:1px solid #fde68a;border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:#92400e;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Ventes totales</div>
                <div style="font-size:28px;font-weight:700;color:#111827;margin-top:4px;">${fmtNumber(data.metrics.totalSales)}</div>
              </div>
            </td>
            <td width="50%" style="padding-left:8px;padding-bottom:12px;">
              <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:#6d28d9;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Chiffre d'affaires</div>
                <div style="font-size:20px;font-weight:700;color:#111827;margin-top:4px;">${fmtNumber(data.metrics.totalRevenue)}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td width="50%" style="padding-right:8px;padding-bottom:12px;">
              <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:#0369a1;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Utilisateurs total</div>
                <div style="font-size:28px;font-weight:700;color:#111827;margin-top:4px;">${fmtNumber(data.metrics.totalUsers)}</div>
              </div>
            </td>
            <td width="50%" style="padding-left:8px;padding-bottom:12px;">
              <div style="background:${data.metrics.failedPayments > 0 ? '#fef2f2' : '#f9fafb'};border:1px solid ${data.metrics.failedPayments > 0 ? '#fecaca' : '#e5e7eb'};border-radius:8px;padding:16px;">
                <div style="font-size:11px;color:${data.metrics.failedPayments > 0 ? '#dc2626' : '#6b7280'};font-weight:600;text-transform:uppercase;letter-spacing:1px;">Paiements échoués</div>
                <div style="font-size:28px;font-weight:700;color:${data.metrics.failedPayments > 0 ? '#dc2626' : '#111827'};margin-top:4px;">${fmtNumber(data.metrics.failedPayments)}</div>
              </div>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Alerts -->
      ${data.metrics.expiringPlans > 0 ? `
      <tr><td style="padding:0 32px;">
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;display:flex;align-items:center;">
          <span style="font-size:18px;margin-right:10px;">&#9888;&#65039;</span>
          <span style="font-size:13px;color:#92400e;"><strong>${data.metrics.expiringPlans} boutique(s)</strong> avec plan expirant dans les 7 prochains jours.</span>
        </div>
      </td></tr>` : ''}

      <!-- Legend -->
      <tr><td style="padding:24px 32px;">
        <div style="font-size:12px;font-weight:700;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:10px;">Légende</div>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-right:20px;font-size:13px;color:#374151;">&#9728;&#65039; <strong style="color:#16a34a;">All OK</strong></td>
            <td style="padding-right:20px;font-size:13px;color:#374151;">&#127746; <strong style="color:#d97706;">Perturbation sans impact</strong></td>
            <td style="font-size:13px;color:#374151;">&#9928;&#65039; <strong style="color:#dc2626;">Incident P1/P2</strong></td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr style="background:#f9fafb;border-top:1px solid #e5e7eb;">
        <td style="padding:16px 32px;text-align:center;font-size:11px;color:#9ca3af;">
          Pour toute question, contactez l'équipe technique &mdash;
          <a href="mailto:yahaya.dev@gmail.com" style="color:#073e8a;text-decoration:none;">yahaya.dev@gmail.com</a><br>
          <span style="margin-top:4px;display:block;">StockShop &mdash; Rapport automatique quotidien</span>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`
}
