'use client'

import type { TicketLogo, TicketWidth } from './ticket'

// Logo de la boutique préparé pour une imprimante thermique : redimensionné à
// la résolution du rouleau (8 points/mm, standard 203 dpi), fond blanc, passé
// en noir et blanc par tramage (une thermique n'imprime que du noir). Le même
// canvas sert au PDF (dataUrl) et à l'ESC/POS (source).
//
// Largeur imprimée : 24 mm sur 58 mm, 32 mm sur 80 mm — un logo, pas une
// bannière : chaque millimètre de hauteur coûte du papier au commerçant.
const LOGO_DOTS: Record<TicketWidth, number> = { 58: 192, 80: 256 }
const MAX_HEIGHT_DOTS = 160 // 20 mm

const cache = new Map<string, Promise<TicketLogo | null>>()

/** Marque StockShop (fichier statique, noir et blanc) imprimée au pied du ticket. */
export const STOCKSHOP_MARK_URL = '/receipt/stockshop-mark.png'

export interface LogoSize {
  /** Largeur imprimée en points (8/mm). */
  dots?: number
  /** Hauteur maximale en points. */
  maxHeight?: number
}

export function loadTicketLogo(url: string, width: TicketWidth, size?: LogoSize): Promise<TicketLogo | null> {
  const dots = size?.dots ?? LOGO_DOTS[width]
  const maxHeight = size?.maxHeight ?? MAX_HEIGHT_DOTS
  const key = `${dots}|${maxHeight}|${url}`
  let p = cache.get(key)
  if (!p) {
    p = build(url, dots, maxHeight).catch(() => null)
    cache.set(key, p)
    // Pas de mise en cache d'un échec (réseau coupé) : on réessaiera au prochain ticket
    p.then(r => { if (!r) cache.delete(key) })
  }
  return p
}

async function build(url: string, targetDots: number, maxHeightDots: number): Promise<TicketLogo | null> {
  // fetch → blob → URL locale : l'image est « même origine », le canvas n'est pas
  // bloqué (pas de souci CORS avec le stockage Supabase), et le cache hors ligne
  // du service worker répond si le réseau est coupé.
  const res = await fetch(url)
  if (!res.ok) return null
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = objectUrl
    })
    if (!img.naturalWidth || !img.naturalHeight) return null

    // Marges blanches (ou transparentes) retirées : beaucoup de logos ont un
    // cadre vide qui rapetisse le motif et gaspille du papier.
    const crop = whiteBorderCrop(img)

    // Dimensions en points, multiples de 8 (exigence des imprimantes)
    let w = targetDots
    let h = Math.round((crop.h / crop.w) * w)
    if (h > maxHeightDots) { w = Math.round((maxHeightDots / h) * w); h = maxHeightDots }
    w = Math.max(8, Math.round(w / 8) * 8)
    h = Math.max(8, Math.round(h / 8) * 8)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff' // les zones transparentes doivent sortir blanches, pas noires
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
    ditherAtkinson(ctx, w, h)
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h, source: canvas }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Boîte englobante du contenu non blanc (analyse sur une copie réduite à
// 512 px pour rester rapide sur un téléphone d'entrée de gamme).
function whiteBorderCrop(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
  const full = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  const W = Math.max(1, Math.round(img.naturalWidth * scale)), H = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const ctx = c.getContext('2d'); if (!ctx) return full
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H)
  const d = ctx.getImageData(0, 0, W, H).data
  let minX = W, minY = H, maxX = -1, maxY = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4
    if (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2] < 235) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return full // image entièrement blanche : rien à recadrer
  const pad = 2
  const x0 = Math.max(0, minX - pad), y0 = Math.max(0, minY - pad)
  const x1 = Math.min(W, maxX + pad + 1), y1 = Math.min(H, maxY + pad + 1)
  return { x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale }
}

// Tramage d'Atkinson : garde les dégradés lisibles sans paver de noir les
// grandes surfaces claires (meilleur rendu qu'un simple seuil sur les logos).
function ditherAtkinson(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
  const spread = (x: number, y: number, err: number) => {
    if (x >= 0 && x < w && y < h) gray[y * w + x] += err
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = gray[i] < 128 ? 0 : 255
      const err = (gray[i] - v) / 8
      gray[i] = v
      spread(x + 1, y, err); spread(x + 2, y, err)
      spread(x - 1, y + 1, err); spread(x, y + 1, err); spread(x + 1, y + 1, err)
      spread(x, y + 2, err)
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = gray[i] < 128 ? 0 : 255
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v
    d[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}
