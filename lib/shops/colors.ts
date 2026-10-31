// ── Couleur d'une boutique (migration 191) ───────────────────────────────────
// 8 teintes, jamais le rouge ni le vert (réservés aux alertes : rupture, ouverte / fermée). Attribuée par la base
// (ordre de création dans l'entreprise, puis première teinte libre) ; modifiable par le propriétaire.
// Avant la 191 (ou valeur inconnue) : teinte DÉTERMINISTE tirée de l'identifiant, identique pour tout le monde.
// Classes écrites en entier (Tailwind ne génère que les classes qu'il voit dans le code).

export const SHOP_COLORS = ['blue', 'violet', 'teal', 'pink', 'indigo', 'cyan', 'amber', 'slate'] as const
export type ShopColor = typeof SHOP_COLORS[number]

export const SHOP_COLOR_CLASSES: Record<ShopColor, { solid: string; soft: string; dot: string }> = {
  blue:   { solid: 'bg-blue-600 text-white',   soft: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',       dot: 'bg-blue-600 dark:bg-blue-400' },
  violet: { solid: 'bg-violet-600 text-white', soft: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300', dot: 'bg-violet-600 dark:bg-violet-400' },
  teal:   { solid: 'bg-teal-600 text-white',   soft: 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',       dot: 'bg-teal-600 dark:bg-teal-400' },
  pink:   { solid: 'bg-pink-600 text-white',   soft: 'bg-pink-50 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300',       dot: 'bg-pink-600 dark:bg-pink-400' },
  indigo: { solid: 'bg-indigo-600 text-white', soft: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300', dot: 'bg-indigo-600 dark:bg-indigo-400' },
  cyan:   { solid: 'bg-cyan-700 text-white',   soft: 'bg-cyan-50 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300',       dot: 'bg-cyan-600 dark:bg-cyan-400' },
  amber:  { solid: 'bg-amber-600 text-white',  soft: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',   dot: 'bg-amber-500 dark:bg-amber-400' },
  slate:  { solid: 'bg-slate-600 text-white',  soft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',     dot: 'bg-slate-500 dark:bg-slate-400' },
}

export const isShopColor = (c: unknown): c is ShopColor => typeof c === 'string' && (SHOP_COLORS as readonly string[]).includes(c)

/** Teinte d'une boutique : la sienne, sinon une teinte stable tirée de son identifiant */
export function shopColorOf(shop: { id?: string | null; color?: string | null } | null | undefined): ShopColor {
  if (shop && isShopColor(shop.color)) return shop.color
  const id = shop?.id ?? ''
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return SHOP_COLORS[h % SHOP_COLORS.length]
}

/** Initiales (2 lettres) d'un nom court : « Akwa » → « AK », « Lagos centre » → « LC » */
export function shopInitials(label: string | null | undefined): string {
  const words = (label ?? '').trim().split(/[\s\-–—·|/:,]+/).filter(Boolean)
  if (!words.length) return '?'
  const letters = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)
  return letters.toUpperCase()
}
