// Dates en haoussa (lot « dates haoussa partout », 31 oct. 2026). Chrome, Edge et la plupart des navigateurs Android
// n'ont pas les noms de jours et de mois haoussa : demandée en « ha », une date s'écrivait dans la langue du système
// (« Samedi 24 Octobre » au milieu d'un écran haoussa). Ce module écrit la date avec les noms haoussa de référence
// (CLDR) : « Asabar 24 Oktoba, 2026 », « 24 Okt », « 24/10/2026 », « 22:57 ». Jamais un mot français ni anglais.
// Les chiffres (jour, mois, année, heure) viennent d'Intl en anglais britannique, dans le fuseau demandé.

export const HA_MONTHS = ['Janairu', 'Faburairu', 'Maris', 'Afirilu', 'Mayu', 'Yuni', 'Yuli', 'Agusta', 'Satumba', 'Oktoba', 'Nuwamba', 'Disamba']
export const HA_MONTHS_SHORT = ['Jan', 'Fab', 'Mar', 'Afi', 'May', 'Yun', 'Yul', 'Agu', 'Sat', 'Okt', 'Nuw', 'Dis']
export const HA_DAYS = ['Lahadi', 'Litinin', 'Talata', 'Laraba', 'Alhamis', "Jumma'a", 'Asabar']
export const HA_DAYS_SHORT = ['Lah', 'Lit', 'Tal', 'Lar', 'Alh', 'Jum', 'Asa']

const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Le navigateur a-t-il lui-même les mots haoussa ? (Node et Safari récents : oui ; Chrome, Edge : non) */
let nativeHausa: boolean | null = null
export function hasNativeHausa(): boolean {
  if (nativeHausa === null) {
    try { nativeHausa = new Intl.DateTimeFormat('ha', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 9, 15))) === 'Oktoba' }
    catch { nativeHausa = false }
  }
  return nativeHausa
}

export function isHausaTag(locales: unknown): boolean {
  const first = Array.isArray(locales) ? locales[0] : locales
  return typeof first === 'string' && /^ha(-|$)/i.test(first)
}

type Kind = 'date' | 'time' | 'any'

/**
 * Date et / ou heure en haoussa, avec les mêmes options que toLocaleDateString / toLocaleTimeString / toLocaleString.
 * `kind` donne les champs par défaut quand `options` n'en demande aucun (date seule, heure seule, ou les deux).
 */
export function formatHausaDate(value: Date | string | number, options: Intl.DateTimeFormatOptions = {}, kind: Kind = 'any'): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Invalid Date'
  let o: Intl.DateTimeFormatOptions = { ...options }
  // dateStyle / timeStyle → champs équivalents
  const ds = o.dateStyle, ts = o.timeStyle
  delete o.dateStyle; delete o.timeStyle
  if (ds === 'full') o = { ...o, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  else if (ds === 'long') o = { ...o, day: 'numeric', month: 'long', year: 'numeric' }
  else if (ds === 'medium') o = { ...o, day: 'numeric', month: 'short', year: 'numeric' }
  else if (ds === 'short') o = { ...o, day: '2-digit', month: '2-digit', year: 'numeric' }
  if (ts) o = { ...o, hour: '2-digit', minute: '2-digit', ...(ts === 'medium' || ts === 'long' || ts === 'full' ? { second: '2-digit' } : {}) }
  const hasDate = !!(o.weekday || o.day || o.month || o.year || o.era)
  const hasTime = !!(o.hour || o.minute || o.second)
  if (!hasDate && !hasTime) {
    if (kind !== 'time') o = { ...o, day: '2-digit', month: '2-digit', year: 'numeric' }
    if (kind !== 'date') o = { ...o, hour: '2-digit', minute: '2-digit', ...(kind === 'any' || kind === 'time' ? { second: '2-digit' } : {}) }
  }

  // Chiffres dans le fuseau demandé
  const parts: Record<string, string> = {}
  try {
    for (const p of new Intl.DateTimeFormat('en-GB', {
      timeZone: o.timeZone, weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(date)) parts[p.type] = p.value
  } catch {
    parts.weekday = WEEKDAY_EN[date.getDay()]; parts.day = String(date.getDate()); parts.month = String(date.getMonth() + 1)
    parts.year = String(date.getFullYear()); parts.hour = String(date.getHours()); parts.minute = String(date.getMinutes()); parts.second = String(date.getSeconds())
  }
  const two = (s: string) => s.padStart(2, '0')
  const dayN = Number(parts.day), monthN = Number(parts.month), yearN = Number(parts.year)
  const wd = WEEKDAY_EN.indexOf(parts.weekday)

  let dateText = ''
  if (o.weekday || o.day || o.month || o.year) {
    const numericMonth = o.month === 'numeric' || o.month === '2-digit'
    const yearText = o.year === '2-digit' ? two(String(yearN % 100)) : String(yearN)
    if (numericMonth) {
      // 24/10/2026, 24/10
      const d = o.day ? (o.day === '2-digit' ? two(String(dayN)) : String(dayN)) : ''
      const m = o.month === '2-digit' || o.day === '2-digit' ? two(String(monthN)) : String(monthN)
      dateText = [d, m, o.year ? yearText : ''].filter(Boolean).join('/')
    } else {
      // Asabar 24 Oktoba, 2026 (CLDR : EEEE d MMMM, y)
      const d = o.day ? (o.day === '2-digit' ? two(String(dayN)) : String(dayN)) : ''
      const m = o.month ? (o.month === 'long' ? HA_MONTHS[monthN - 1] : HA_MONTHS_SHORT[monthN - 1]) : ''
      const head = [d, m].filter(Boolean).join(' ')
      // Virgule seulement après un jour (« 24 Oktoba, 2026 ») ; mois et année : « Oktoba 2026 » (CLDR yMMMM)
      dateText = o.year ? (head ? (d ? `${head}, ${yearText}` : `${head} ${yearText}`) : yearText) : head
    }
    if (o.weekday && wd >= 0) {
      const w = o.weekday === 'long' ? HA_DAYS[wd] : HA_DAYS_SHORT[wd]
      dateText = dateText ? `${w} ${dateText}` : w
    }
  }
  let timeText = ''
  if (o.hour || o.minute || o.second) {
    const h = two(String(Number(parts.hour) % 24)), mi = two(parts.minute || '0'), s = two(parts.second || '0')
    timeText = o.second ? `${h}:${mi}:${s}` : `${h}:${mi}`
  }
  return [dateText, timeText].filter(Boolean).join(', ')
}
