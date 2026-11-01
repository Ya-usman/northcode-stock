// Branche les dates haoussa (lib/i18n/hausa-dates) sur les fonctions de date du navigateur, UNE fois, au démarrage
// de l'application (31 oct. 2026). Seules les demandes en haoussa (« ha », « ha-NG »…) sont concernées, et seulement
// quand le navigateur n'a pas lui-même les mots haoussa : le français, l'anglais et tout le reste passent inchangés.
// Couvre d'un coup les ~135 affichages de dates des écrans (toLocaleDateString / toLocaleTimeString / toLocaleString).
import { formatHausaDate, hasNativeHausa, isHausaTag } from './hausa-dates'

let installed = false

export function installHausaDates(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  if (hasNativeHausa()) return
  const proto = Date.prototype as any
  const origDate = proto.toLocaleDateString
  const origTime = proto.toLocaleTimeString
  const origAll = proto.toLocaleString
  proto.toLocaleDateString = function (this: Date, locales?: any, options?: Intl.DateTimeFormatOptions) {
    return isHausaTag(locales) ? formatHausaDate(this, options, 'date') : origDate.call(this, locales, options)
  }
  proto.toLocaleTimeString = function (this: Date, locales?: any, options?: Intl.DateTimeFormatOptions) {
    return isHausaTag(locales) ? formatHausaDate(this, options, 'time') : origTime.call(this, locales, options)
  }
  proto.toLocaleString = function (this: Date, locales?: any, options?: Intl.DateTimeFormatOptions) {
    return isHausaTag(locales) ? formatHausaDate(this, options, 'any') : origAll.call(this, locales, options)
  }
}
