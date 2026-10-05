// Éléments communs des e-mails StockShop (alertes propriétaires, bilan du matin…).

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

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

/** Squelette commun : fond clair, marque, carte blanche, pied gris */
export function emailShell(p: { appUrl: string; body: string; footer: string }): string {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap" rel="stylesheet"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:28px 12px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td style="padding:0 4px 14px;">${brandHeader(p.appUrl)}</td></tr>
  <tr><td style="background:#fff;border-radius:14px;padding:24px 24px 8px;box-shadow:0 2px 12px rgba(7,62,138,0.06);">
    ${p.body}
  </td></tr>
  <tr><td style="padding:16px 8px 0;font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">${p.footer}</td></tr>
</table></td></tr></table>
</body></html>`
}
