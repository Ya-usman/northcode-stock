import { fr, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// Dates à l'écran : toujours dans la langue de l'interface, jamais un format
// français figé. Le français garde exactement son rendu d'origine.

// Langue des dates pour date-fns — français, sinon anglais (date-fns n'a pas
// de jeu de dates haoussa : même repli que les écrans Notes et Équipe).
export function dateFnsLocale(locale: string): Locale {
  return locale === 'fr' ? fr : enUS
}

// Étiquette de langue pour `toLocaleDateString` / `toLocaleString` : anglais
// britannique (jour avant le mois, 24 h), comme les e-mails et les exports.
const DATE_TAG: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' }
export function dateLocaleTag(locale?: string | null): string {
  return DATE_TAG[locale || 'fr'] ?? 'fr-FR'
}

// Motif « date et heure » : « 12 oct. 2026 à 17:38 » en français,
// « 12 Oct 2026, 17:38 » dans les autres langues.
export function dateTimePattern(locale: string): string {
  return locale === 'fr' ? "dd MMM yyyy 'à' HH:mm" : 'dd MMM yyyy, HH:mm'
}

// ── Dates sans mot d'une autre langue ───────────────────────────────────────
// Beaucoup de navigateurs n'ont pas les noms de jours et de mois haoussa : la
// date s'écrirait alors dans la langue du système (du français ou de l'anglais
// au milieu d'un écran haoussa). Quand la langue de l'écran n'est pas
// disponible, on n'emprunte les mots d'aucune autre langue : la date s'écrit
// en chiffres (13/10/2026), l'heure aussi (16:48). Le français et l'anglais,
// toujours disponibles, gardent leur rendu habituel.
const available: Record<string, boolean> = {}
function hasDateWords(tag: string): boolean {
  if (!(tag in available)) {
    try { available[tag] = Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0 } catch { available[tag] = false }
  }
  return available[tag]
}
const two = (n: number) => String(n).padStart(2, '0')

/** Date dans la langue de l'écran (`options` de `toLocaleDateString`) ; en chiffres si cette langue manque au navigateur. */
export function formatLocaleDate(value: Date | string | number, locale: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value)
  const tag = dateLocaleTag(locale)
  if (hasDateWords(tag)) return date.toLocaleDateString(tag, options)
  const dayMonth = `${two(date.getDate())}/${two(date.getMonth() + 1)}`
  return options.year ? `${dayMonth}/${date.getFullYear()}` : dayMonth
}

/** Heure et minutes sur 24 h, dans la langue de l'écran ; en chiffres si cette langue manque au navigateur. */
export function formatLocaleTime(value: Date | string | number, locale: string | null | undefined): string {
  const date = value instanceof Date ? value : new Date(value)
  const tag = dateLocaleTag(locale)
  if (hasDateWords(tag)) return date.toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit' })
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
