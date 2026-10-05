// Journée locale d'une boutique : bornes UTC de « aujourd'hui » dans le fuseau
// de son pays. Fonctions pures (testables).

const TZ_BY_COUNTRY: Record<string, string> = {
  NG: 'Africa/Lagos', NE: 'Africa/Niamey', CM: 'Africa/Douala', CI: 'Africa/Abidjan', ML: 'Africa/Bamako',
  SN: 'Africa/Dakar', BJ: 'Africa/Porto-Novo', TG: 'Africa/Lome', BF: 'Africa/Ouagadougou', GH: 'Africa/Accra',
  GN: 'Africa/Conakry', GW: 'Africa/Bissau', GM: 'Africa/Banjul', SL: 'Africa/Freetown', LR: 'Africa/Monrovia',
  CV: 'Atlantic/Cape_Verde', MR: 'Africa/Nouakchott', CD: 'Africa/Kinshasa', CG: 'Africa/Brazzaville',
  GA: 'Africa/Libreville', GQ: 'Africa/Malabo', CF: 'Africa/Bangui', TD: 'Africa/Ndjamena',
  US: 'America/New_York', CA: 'America/Toronto', GB: 'Europe/London', PT: 'Europe/Lisbon', IE: 'Europe/Dublin',
}

/** Fuseau d'un pays (Europe continentale → Paris, inconnu → Lagos) */
export function timeZoneFor(country: string | null | undefined): string {
  const c = (country || '').toUpperCase()
  if (TZ_BY_COUNTRY[c]) return TZ_BY_COUNTRY[c]
  if (['FR', 'BE', 'LU', 'DE', 'NL', 'IT', 'ES', 'AT', 'DK', 'SE', 'PL', 'CZ', 'SK', 'SI', 'HR', 'HU', 'MT'].includes(c)) return 'Europe/Paris'
  if (['FI', 'EE', 'LV', 'LT', 'RO', 'BG', 'GR', 'CY'].includes(c)) return 'Europe/Helsinki'
  return 'Africa/Lagos'
}

/** Décalage (ms) du fuseau à l'instant donné : heure locale − UTC */
function offsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at.getTime() / 1000) * 1000
}

/** Journée locale contenant `at`, décalée de `daysAgo` jours : bornes UTC [start, end[ et date AAAA-MM-JJ */
export function localDay(tz: string, at = new Date(), daysAgo = 0): { start: Date; end: Date; date: string } {
  const off = offsetMs(tz, at)
  const local = new Date(at.getTime() + off)
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), d = local.getUTCDate() - daysAgo
  const startLocal = Date.UTC(y, m, d), endLocal = Date.UTC(y, m, d + 1)
  const date = new Date(startLocal).toISOString().slice(0, 10)
  return { start: new Date(startLocal - offsetMs(tz, new Date(startLocal - off))), end: new Date(endLocal - offsetMs(tz, new Date(endLocal - off))), date }
}
