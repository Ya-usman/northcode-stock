// Liste d'attente des métiers (lot C, migration 217) : règles communes au formulaire et au serveur. Pur, sans import
// serveur. Les mêmes contrôles sont tenus par la base (contrainte waitlist_check) : le serveur normalise, la base refuse
// ce qui ne respecte pas le format.

export const WAITLIST_SECTORS = ['health', 'services', 'education', 'rental', 'hospitality', 'restaurant', 'beauty', 'property', 'other'] as const
export type WaitlistSector = (typeof WAITLIST_SECTORS)[number]

/** Sous-métiers proposés par métier (facultatifs). */
export const WAITLIST_SUB_TRADES: Partial<Record<WaitlistSector, readonly string[]>> = {
  health: ['clinic', 'pharmacy', 'laboratory', 'medical_office', 'care_center'],
}

export const WAITLIST_LOCALES = ['fr', 'en', 'ha'] as const

export type NormalizedContact = { kind: 'email' | 'phone'; value: string }

/**
 * E-mail : minuscules, sans espaces, une @ et un point dans le domaine, 254 caractères au plus.
 * Téléphone : espaces, points, tirets et parenthèses retirés ; « 00 » en tête devient « + » ; 6 à 15 chiffres.
 */
export function normalizeContact(raw: unknown): NormalizedContact | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 254) return null
  if (s.includes('@')) {
    const e = s.toLowerCase()
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length >= 6 ? { kind: 'email', value: e } : null
  }
  let p = s.replace(/[\s.\-()]/g, '')
  if (p.startsWith('00')) p = '+' + p.slice(2)
  return /^\+?[0-9]{6,15}$/.test(p) ? { kind: 'phone', value: p } : null
}

export function isWaitlistSector(v: unknown): v is WaitlistSector {
  return typeof v === 'string' && (WAITLIST_SECTORS as readonly string[]).includes(v)
}

export function isSubTradeOf(sector: WaitlistSector, sub: unknown): sub is string {
  return typeof sub === 'string' && !!WAITLIST_SUB_TRADES[sector]?.includes(sub)
}
