// Fuseaux horaires des boutiques (migration 178) — module PUR, utilisable côté serveur comme côté client.
//
// shops.timezone (IANA) est la SEULE source de la date métier d'une boutique. Ce module fournit :
//   • COUNTRY_TIME_ZONES : zones AUTORISÉES par pays (même liste que la fonction SQL country_time_zones —
//     un test garantit qu'elles restent identiques) ; pays à fuseau unique → une seule zone ;
//   • countryDefaultTimeZone : fuseau par défaut d'un pays à fuseau unique, null sinon (US, CA, CD, ES, PT) —
//     sert UNIQUEMENT à proposer / initialiser une valeur, jamais de source de vérité ;
//   • resolveShopTimeZone : règle de création / changement de pays commune à toutes les routes serveur ;
//   • zoneOptions : présentation humaine (« Heure de Chicago (GMT-5) ») pour les pays à plusieurs fuseaux ;
//   • businessDate : date métier (AAAA-MM-JJ) d'un instant dans un fuseau.

const DEFAULTS: Record<string, string> = {
  AT: 'Europe/Vienna', BE: 'Europe/Brussels', BF: 'Africa/Ouagadougou', BG: 'Europe/Sofia', BJ: 'Africa/Porto-Novo',
  CF: 'Africa/Bangui', CG: 'Africa/Brazzaville', CI: 'Africa/Abidjan', CM: 'Africa/Douala', CV: 'Atlantic/Cape_Verde',
  CY: 'Asia/Nicosia', CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK: 'Europe/Copenhagen', EE: 'Europe/Tallinn',
  FI: 'Europe/Helsinki', FR: 'Europe/Paris', GA: 'Africa/Libreville', GB: 'Europe/London', GH: 'Africa/Accra',
  GM: 'Africa/Banjul', GN: 'Africa/Conakry', GQ: 'Africa/Malabo', GR: 'Europe/Athens', GW: 'Africa/Bissau',
  HR: 'Europe/Zagreb', HU: 'Europe/Budapest', IE: 'Europe/Dublin', IT: 'Europe/Rome', LR: 'Africa/Monrovia',
  LT: 'Europe/Vilnius', LU: 'Europe/Luxembourg', LV: 'Europe/Riga', ML: 'Africa/Bamako', MR: 'Africa/Nouakchott',
  MT: 'Europe/Malta', NE: 'Africa/Niamey', NG: 'Africa/Lagos', NL: 'Europe/Amsterdam', PL: 'Europe/Warsaw',
  RO: 'Europe/Bucharest', SE: 'Europe/Stockholm', SI: 'Europe/Ljubljana', SK: 'Europe/Bratislava', SL: 'Africa/Freetown',
  SN: 'Africa/Dakar', TD: 'Africa/Ndjamena', TG: 'Africa/Lome',
}

/** Pays à plusieurs fuseaux : toutes les zones IANA acceptées (zone.tab) */
const MULTI: Record<string, string[]> = {
  US: ['America/New_York', 'America/Detroit', 'America/Kentucky/Louisville', 'America/Kentucky/Monticello',
    'America/Indiana/Indianapolis', 'America/Indiana/Vincennes', 'America/Indiana/Winamac', 'America/Indiana/Marengo',
    'America/Indiana/Petersburg', 'America/Indiana/Vevay', 'America/Chicago', 'America/Indiana/Tell_City', 'America/Indiana/Knox',
    'America/Menominee', 'America/North_Dakota/Center', 'America/North_Dakota/New_Salem', 'America/North_Dakota/Beulah',
    'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'America/Juneau',
    'America/Sitka', 'America/Metlakatla', 'America/Yakutat', 'America/Nome', 'America/Adak', 'Pacific/Honolulu'],
  CA: ['America/St_Johns', 'America/Halifax', 'America/Glace_Bay', 'America/Moncton', 'America/Goose_Bay',
    'America/Toronto', 'America/Iqaluit', 'America/Winnipeg', 'America/Resolute', 'America/Rankin_Inlet', 'America/Regina',
    'America/Swift_Current', 'America/Edmonton', 'America/Cambridge_Bay', 'America/Inuvik', 'America/Dawson_Creek',
    'America/Fort_Nelson', 'America/Whitehorse', 'America/Dawson', 'America/Vancouver', 'America/Atikokan',
    'America/Blanc-Sablon', 'America/Creston'],
  CD: ['Africa/Kinshasa', 'Africa/Lubumbashi'],
  ES: ['Europe/Madrid', 'Africa/Ceuta', 'Atlantic/Canary'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
}

/** Zones proposées en premier dans la liste (les autres zones autorisées restent acceptées, ex. fuseau de l'appareil) */
const PRIMARY: Record<string, string[]> = {
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
  CA: ['America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/Winnipeg', 'America/Regina', 'America/Edmonton', 'America/Vancouver'],
  CD: ['Africa/Kinshasa', 'Africa/Lubumbashi'],
  ES: ['Europe/Madrid', 'Atlantic/Canary'],
  PT: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'],
}

/** Zones autorisées pour un pays (null = pays inconnu : aucune zone acceptée) — miroir de country_time_zones (SQL) */
export function countryTimeZones(country: string | null | undefined): string[] | null {
  const c = (country || '').toUpperCase()
  if (MULTI[c]) return MULTI[c]
  return DEFAULTS[c] ? [DEFAULTS[c]] : null
}

/** Fuseau par défaut d'un pays à fuseau UNIQUE, null pour un pays à plusieurs fuseaux ou inconnu — miroir SQL */
export function countryDefaultTimeZone(country: string | null | undefined): string | null {
  return DEFAULTS[(country || '').toUpperCase()] ?? null
}

export const isMultiTimeZoneCountry = (country: string | null | undefined) => !!MULTI[(country || '').toUpperCase()]

export function isTimeZoneOfCountry(tz: string | null | undefined, country: string | null | undefined): boolean {
  return !!tz && (countryTimeZones(country) ?? []).includes(tz)
}

/** Pays dont la liste contient ce fuseau, s'il est UNIQUE (ex. Africa/Douala → CM) ; sinon null */
export function countryOfTimeZone(tz: string | null | undefined): string | null {
  if (!tz) return null
  const hits = KNOWN_COUNTRIES().filter(c => (countryTimeZones(c) ?? []).includes(tz))
  return hits.length === 1 ? hits[0] : null
}
const KNOWN_COUNTRIES = () => [...Object.keys(DEFAULTS), ...Object.keys(MULTI)]

/** Fuseau de l'appareil (navigateur / téléphone), ou null */
export function deviceTimeZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null }
}

/** Valeur à présélectionner : fuseau de l'appareil s'il appartient au pays, sinon fuseau unique du pays, sinon rien */
export function suggestTimeZone(country: string | null | undefined, device = deviceTimeZone()): string | null {
  if (device && isTimeZoneOfCountry(device, country)) return device
  return countryDefaultTimeZone(country)
}

/**
 * Règle serveur commune (création d'une boutique, changement de pays) :
 *   • fuseau demandé valable pour le pays → retenu ;
 *   • sinon fuseau actuel encore valable pour le pays (changement de pays) → conservé ;
 *   • sinon fuseau unique du pays ;
 *   • sinon null → l'appelant refuse (shop_timezone_required) : jamais de déduction arbitraire.
 * Un fuseau demandé mais incohérent avec le pays est signalé (invalid) au lieu d'être ignoré.
 */
export function resolveShopTimeZone(input: { country: string | null | undefined; requested?: unknown; current?: string | null }):
  { timezone: string | null; invalid: boolean } {
  const requested = typeof input.requested === 'string' && input.requested.trim() ? input.requested.trim() : null
  if (requested) return isTimeZoneOfCountry(requested, input.country) ? { timezone: requested, invalid: false } : { timezone: null, invalid: true }
  if (input.current && isTimeZoneOfCountry(input.current, input.country)) return { timezone: input.current, invalid: false }
  return { timezone: countryDefaultTimeZone(input.country), invalid: false }
}

const CITY_LABELS: Record<string, Partial<Record<'fr' | 'en' | 'ha', string>>> = {
  'America/St_Johns': { fr: 'St. John’s', en: 'St. John’s', ha: 'St. John’s' },
  'Atlantic/Canary': { fr: 'des Canaries', en: 'Canary Islands', ha: 'Tsibirin Canary' },
  'Atlantic/Azores': { fr: 'des Açores', en: 'Azores', ha: 'Azores' },
  'Atlantic/Madeira': { fr: 'de Madère', en: 'Madeira', ha: 'Madeira' },
  'Pacific/Honolulu': { fr: 'd’Hawaï (Honolulu)', en: 'Hawaii (Honolulu)', ha: 'Hawaii (Honolulu)' },
}

function offsetLabel(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date())
      .find(p => p.type === 'timeZoneName')?.value
    return part ? part.replace('GMT', 'GMT') : ''
  } catch { return '' }
}

/** « Heure de Chicago (GMT-5) » / « Chicago time (GMT-5) » / « Lokacin Chicago (GMT-5) » */
export function zoneLabel(tz: string, locale: string): string {
  const lang = (locale === 'en' || locale === 'ha' ? locale : 'fr') as 'fr' | 'en' | 'ha'
  const special = CITY_LABELS[tz]?.[lang]
  const city = tz.split('/').pop()!.replace(/_/g, ' ')
  const off = offsetLabel(tz)
  const base = lang === 'en' ? `${special ?? city} time` : lang === 'ha' ? `Lokacin ${special ?? city}` : special && special.startsWith('d') ? `Heure ${special}` : `Heure de ${special ?? city}`
  return off ? `${base} (${off})` : base
}

/** Options humaines pour un pays (zones principales + fuseau courant / de l'appareil s'il est valable et absent) */
export function zoneOptions(country: string | null | undefined, locale: string, extra?: (string | null | undefined)[]): { value: string; label: string }[] {
  const c = (country || '').toUpperCase()
  const base = PRIMARY[c] ?? countryTimeZones(c) ?? []
  const all = [...base]
  for (const z of extra ?? []) if (z && isTimeZoneOfCountry(z, c) && !all.includes(z)) all.push(z)
  return all.map(value => ({ value, label: zoneLabel(value, locale) }))
}

/** Date métier AAAA-MM-JJ de l'instant `at` dans le fuseau `tz` (fuseau de la boutique, jamais celui de l'appareil) */
export function businessDate(tz: string, at: Date = new Date()): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at).filter(x => x.type !== 'literal').map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Tous les codes pays connus (tests de cohérence avec la base) */
export const KNOWN_TIME_ZONE_COUNTRIES = [...Object.keys(DEFAULTS), ...Object.keys(MULTI)].sort()
