// Couleur de la palette la plus proche d'un logo (31 oct. 2026) : simple SUGGESTION dans les Paramètres, jamais
// appliquée d'office. Le logo est réduit à 32×32 ; on ignore le transparent, le blanc, le noir et les gris ; la teinte
// la plus présente (pondérée par la saturation) est rapprochée des 8 teintes de la boutique. Logo sans couleur
// franche (noir et blanc) : ardoise.
import { SHOP_COLORS, type ShopColor } from '@/lib/shops/colors'

// Teinte (degrés) de chaque couleur de la palette (Tailwind 600)
const HUES: Record<Exclude<ShopColor, 'slate'>, number> = { blue: 221, violet: 262, teal: 173, pink: 330, indigo: 239, cyan: 192, amber: 38 }

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

const hueDistance = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

/** Teinte de palette la plus proche d'une teinte (degrés) */
export function nearestShopColorForHue(hue: number): ShopColor {
  let best: ShopColor = 'blue', dist = Infinity
  for (const [c, h] of Object.entries(HUES) as [ShopColor, number][]) {
    const d = hueDistance(hue, h)
    if (d < dist) { dist = d; best = c }
  }
  return best
}

/** Couleur dominante d'une liste de pixels RGBA (Uint8ClampedArray) → teinte de palette */
export function dominantShopColor(data: ArrayLike<number>): ShopColor {
  const bins = new Array(36).fill(0)
  let colored = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
    if (s < 0.25 || l < 0.12 || l > 0.92) continue // gris, noir, blanc
    bins[Math.floor(h / 10) % 36] += s
    colored++
  }
  if (colored < 8) return 'slate'
  const top = bins.indexOf(Math.max(...bins))
  return nearestShopColorForHue(top * 10 + 5)
}

/** Navigateur : couleur de palette suggérée pour l'image d'un logo (null si l'image ne peut pas être lue) */
export function suggestShopColorFromLogo(url: string): Promise<ShopColor | null> {
  return new Promise(resolve => {
    if (typeof window === 'undefined' || !url) return resolve(null)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const size = 32
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, size, size)
        const c = dominantShopColor(ctx.getImageData(0, 0, size, size).data)
        resolve((SHOP_COLORS as readonly string[]).includes(c) ? c : null)
      } catch { resolve(null) } // image d'un autre domaine sans autorisation : pas de suggestion
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
