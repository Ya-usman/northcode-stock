// Logo de la boutique, préparé une fois pour tous les supports : marges
// blanches ou transparentes retirées, proportions conservées, fond blanc,
// PNG (sans perte ; un JPEG rendait noir le fond d'un logo transparent).
// Utilisé à l'import (réglages) et par les PDF (reçu A5, remboursement) ;
// le ticket thermique réutilise whiteBorderCrop puis trame en noir et blanc.
// Navigateur uniquement (Image + canvas) — rien n'est touché à l'import du module.

export interface PreparedLogo {
  dataUrl: string
  width: number
  height: number
  blob: Blob
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image illisible'))
    img.src = src
  })
}

// Boîte englobante du contenu non blanc (analyse sur une copie réduite à
// 512 px pour rester rapide sur un téléphone d'entrée de gamme). Beaucoup de
// logos ont un cadre vide qui rapetisse le motif.
export function whiteBorderCrop(img: HTMLImageElement): { x: number; y: number; w: number; h: number } {
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

/** Fichier importé ou URL → logo normalisé (marges retirées, ≤ maxSide px, fond blanc, PNG). */
export async function prepareLogo(source: Blob | string, maxSide = 512): Promise<PreparedLogo> {
  // fetch → blob → URL locale : image « même origine », le canvas n'est pas
  // bloqué (pas de souci CORS avec le stockage Supabase)
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = await loadImage(objectUrl)
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('image vide')
    const crop = whiteBorderCrop(img)
    const scale = Math.min(1, maxSide / Math.max(crop.w, crop.h))
    const w = Math.max(1, Math.round(crop.w * scale))
    const h = Math.max(1, Math.round(crop.h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas indisponible')
    ctx.fillStyle = '#ffffff' // transparence → blanc, sur tous les supports
    ctx.fillRect(0, 0, w, h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h)
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('export PNG impossible'))), 'image/png'))
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h, blob: png }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

// Cache par URL pour les PDF : une promesse partagée (deux reçus lancés en
// même temps ne téléchargent qu'une fois) ; un échec n'est pas conservé.
const cache = new Map<string, Promise<PreparedLogo>>()
export function getPreparedLogo(url: string): Promise<PreparedLogo> {
  let p = cache.get(url)
  if (!p) {
    p = prepareLogo(url)
    cache.set(url, p)
    p.catch(() => cache.delete(url))
  }
  return p
}
