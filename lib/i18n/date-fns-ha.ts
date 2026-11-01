// Langue haoussa pour date-fns (31 oct. 2026) : date-fns n'en a pas, et le repli était l'anglais (« about 3 hours
// ago », « Oct ») au milieu des écrans haoussa. Construit sur l'anglais (formats de nombres, analyse), avec les mois,
// les jours, les durées et les jours relatifs en haoussa (noms CLDR, voir lib/i18n/hausa-dates).
import { enUS } from 'date-fns/locale'
import type { Locale } from 'date-fns'
import { HA_DAYS, HA_DAYS_SHORT, HA_MONTHS, HA_MONTHS_SHORT } from './hausa-dates'

// Durées : « minti 5 », « awa 3 », « kwana 2 » (le nom avant le nombre, comme dans l'application)
const UNITS: Record<string, [string, string?]> = {
  lessThanXSeconds: ['ƙasa da daƙiƙa {n}'], xSeconds: ['daƙiƙa {n}'], halfAMinute: ['rabin minti'],
  lessThanXMinutes: ['ƙasa da minti {n}'], xMinutes: ['minti {n}'],
  aboutXHours: ['kusan awa {n}'], xHours: ['awa {n}'],
  xDays: ['kwana {n}'], aboutXWeeks: ['kusan mako {n}'], xWeeks: ['mako {n}'],
  aboutXMonths: ['kusan wata {n}'], xMonths: ['wata {n}'],
  aboutXYears: ['kusan shekara {n}'], xYears: ['shekara {n}'], overXYears: ['fiye da shekara {n}'], almostXYears: ['kusan shekara {n}'],
}

const formatDistance: Locale['formatDistance'] = (token, count, options) => {
  const text = (UNITS[token]?.[0] ?? `${count}`).replace('{n}', String(count))
  if (options?.addSuffix) return options.comparison && options.comparison > 0 ? `cikin ${text}` : `${text} da suka wuce`
  return text
}

const RELATIVE: Record<string, string> = {
  lastWeek: "eeee 'da ya gabata,' p", yesterday: "'Jiya,' p", today: "'Yau,' p", tomorrow: "'Gobe,' p", nextWeek: "eeee', ' p", other: 'P',
}

export const ha: Locale = {
  ...enUS,
  code: 'ha',
  formatDistance,
  formatRelative: token => RELATIVE[token] ?? 'P',
  localize: {
    ...enUS.localize,
    month: (n: number, opts?: { width?: string }) => (opts?.width === 'abbreviated' || opts?.width === 'narrow' ? HA_MONTHS_SHORT[n] : HA_MONTHS[n]),
    day: (n: number, opts?: { width?: string }) => (opts?.width === 'wide' || !opts?.width ? HA_DAYS[n] : HA_DAYS_SHORT[n]),
  } as Locale['localize'],
  options: { ...enUS.options, weekStartsOn: 1 },
}
