export interface EveningSummaryData {
  date: string
  totalSales: number
  totalRevenue: number
  totalExpenses: number
  netRevenue: number
  newCustomers: number
  unpaidSales: number
  activeShops: number
  lowStockShops: { shopName: string; count: number }[]
  topProducts: { name: string; shopName: string; qty: number }[]
}

export function buildEveningSummaryHtml(data: EveningSummaryData): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0 }).format(Math.round(n))

  const lowStockRows = data.lowStockShops.length
    ? data.lowStockShops.map(s => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${s.shopName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600;color:#dc2626;text-align:right;">${s.count} produit(s)</td>
        </tr>`).join('')
    : `<tr><td colspan="2" style="padding:12px;text-align:center;font-size:13px;color:#16a34a;">✅ Aucune alerte stock</td></tr>`

  const topProductRows = data.topProducts.length
    ? data.topProducts.slice(0, 5).map((p, i) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-align:center;">${i + 1}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;">${p.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;font-size:12px;">${p.shopName}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;font-weight:600;color:#073e8a;text-align:right;">${p.qty}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:12px;text-align:center;font-size:13px;color:#9ca3af;">Aucune vente aujourd'hui</td></tr>`

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      <!-- Header -->
      <tr><td align="center" style="padding-bottom:20px;">
        <table cellpadding="0" cellspacing="0">
          <tr><td style="background:#073e8a;border-radius:12px;padding:10px 22px;">
            <span style="color:#fff;font-size:17px;font-weight:700;">StockShop</span>
            <span style="color:#D4AF37;font-size:17px;font-weight:700;">.</span>
          </td></tr>
        </table>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(7,62,138,0.08);overflow:hidden;">

        <!-- Top bar -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:linear-gradient(135deg,#073e8a 0%,#0d52b8 100%);padding:28px 36px 24px;">
            <p style="margin:0 0 6px;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">Résumé du jour</p>
            <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">🌙 Bilan de la journée</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${data.date}</p>
          </td></tr>
        </table>

        <!-- Body -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:28px 36px;">

            <!-- Key metrics grid -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="width:50%;padding-right:8px;">
                  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#073e8a;">${data.totalSales}</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">Ventes</div>
                  </div>
                </td>
                <td style="width:50%;padding-left:8px;">
                  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#16a34a;">${fmt(data.totalRevenue)} F</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">Recettes</div>
                  </div>
                </td>
              </tr>
              <tr style="height:8px;"></tr>
              <tr>
                <td style="width:50%;padding-right:8px;">
                  <div style="background:#fef9f0;border:1px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:#d97706;">${fmt(data.totalExpenses)} F</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">Dépenses</div>
                  </div>
                </td>
                <td style="width:50%;padding-left:8px;">
                  <div style="background:${data.netRevenue >= 0 ? '#f0fdf4' : '#fef2f2'};border:1px solid ${data.netRevenue >= 0 ? '#bbf7d0' : '#fecaca'};border-radius:10px;padding:16px;text-align:center;">
                    <div style="font-size:22px;font-weight:700;color:${data.netRevenue >= 0 ? '#16a34a' : '#dc2626'};">${data.netRevenue >= 0 ? '+' : ''}${fmt(data.netRevenue)} F</div>
                    <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:0.5px;">Net</div>
                  </div>
                </td>
              </tr>
            </table>

            <!-- Secondary stats -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;padding:4px 0;margin-bottom:24px;">
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
                  👥 Nouveaux clients
                </td>
                <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#073e8a;text-align:right;border-bottom:1px solid #f3f4f6;">
                  ${data.newCustomers}
                </td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">
                  ⏳ Ventes impayées
                </td>
                <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${data.unpaidSales > 0 ? '#d97706' : '#16a34a'};text-align:right;border-bottom:1px solid #f3f4f6;">
                  ${data.unpaidSales}
                </td>
              </tr>
              <tr>
                <td style="padding:10px 16px;font-size:13px;color:#374151;">
                  🏪 Boutiques actives
                </td>
                <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#073e8a;text-align:right;">
                  ${data.activeShops}
                </td>
              </tr>
            </table>

            <!-- Top products -->
            <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">🏆 Produits les plus vendus</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <tr style="background:#f9fafb;">
                <th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:center;font-weight:600;">#</th>
                <th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Produit</th>
                <th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:left;font-weight:600;">Boutique</th>
                <th style="padding:8px 12px;font-size:11px;color:#6b7280;text-align:right;font-weight:600;">Qté</th>
              </tr>
              ${topProductRows}
            </table>

            <!-- Low stock -->
            <p style="margin:0 0 10px;font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">⚠️ Alertes stock faible</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
              ${lowStockRows}
            </table>

          </td></tr>
        </table>

        <!-- Footer bar -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="background:#f9fafb;border-top:3px solid #D4AF37;padding:14px 36px;">
            <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">
              StockShop Stock Manager · Rapport automatique de fin de journée
            </p>
          </td></tr>
        </table>

      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}
