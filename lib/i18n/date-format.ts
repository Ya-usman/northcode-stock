import { fr, enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'

// Dates à l'écran : toujours dans la langue de l'interface, jamais un format
// français figé. Le français garde exactement son rendu d'origine.

// Langue des dates pour date-fns — français, sinon anglais (date-fns n'a pas
// de jeu de dates haoussa : même repli que les écrans Notes et Équipe).
export function dateFnsLocale(locale: string): Locale {
  return locale === 'fr' ? fr : enUS
}

// Motif « date et heure » : « 12 oct. 2026 à 17:38 » en français,
// « 12 Oct 2026, 17:38 » dans les autres langues.
export function dateTimePattern(locale: string): string {
  return locale === 'fr' ? "dd MMM yyyy 'à' HH:mm" : 'dd MMM yyyy, HH:mm'
}
