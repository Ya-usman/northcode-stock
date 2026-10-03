import type { TicketLogo, TicketWidth } from './ticket'

// QR du reçu en IMAGE, pas en commande QR native ESC/POS : les imprimantes
// 58 mm bon marché ne l'ont pas toutes, l'image passe partout. Modules de
// 4 points (58 mm) ou 5 (80 mm) : ≥ 3 points par module pour une lecture
// fiable à 203 dpi, zone de silence de 2 modules, côté arrondi au multiple
// de 8 exigé par les imprimantes. Pour l'URL du reçu (≈ 40 caractères),
// le QR fait 29 modules → ≈ 17 mm en 58 mm, 21 mm en 80 mm.
export async function buildTicketQr(url: string, width: TicketWidth): Promise<TicketLogo | null> {
  try {
    const QRCode = await import('qrcode')
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const scale = width === 58 ? 4 : 5
    const quiet = 2
    const px = (n + quiet * 2) * scale
    const side = Math.ceil(px / 8) * 8
    const off = Math.floor((side - px) / 2) + quiet * scale
    const data = new Uint8ClampedArray(side * side * 4).fill(255)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!qr.modules.get(y, x)) continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const p = ((off + y * scale + dy) * side + (off + x * scale + dx)) * 4
            data[p] = data[p + 1] = data[p + 2] = 0
          }
        }
      }
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = side
      canvas.height = side
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.putImageData(new ImageData(data, side, side), 0, 0)
      return { dataUrl: canvas.toDataURL('image/png'), width: side, height: side, source: canvas }
    }
    // Node (tests) : PNG par la bibliothèque pour le PDF, bitmap brut pour l'ESC/POS
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: quiet, scale })
    return { dataUrl, width: side, height: side, source: { data, width: side, height: side } }
  } catch {
    return null // sans QR plutôt que sans ticket
  }
}
