// P0 « périmé non vendable » (migration 178) — tests PURS, sans base ni serveur : règles communes de l'application
// (lib/time/time-zones, lib/stock/sellable) et cohérence avec le SQL de la migration 178.
// Usage : node tests/e2e/p0-pure.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
const TZ = jiti(ROOT + '/lib/time/time-zones.ts')
const SELL = jiti(ROOT + '/lib/stock/sellable.ts')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

const SQL_FILE = fs.existsSync(ROOT + '/supabase/migrations/178_expired_not_sellable.sql')
  ? ROOT + '/supabase/migrations/178_expired_not_sellable.sql' : ROOT + '/supabase/drafts/178_expired_not_sellable.sql'
const sql = fs.readFileSync(SQL_FILE, 'utf8')

console.log('\n1. Cohérence application ↔ SQL (178) : fuseau par défaut et zones autorisées par pays')
{
  const defBody = sql.match(/FUNCTION public\.country_default_time_zone[\s\S]*?\$\$([\s\S]*?)\$\$/)[1]
  const sqlDefaults = Object.fromEntries([...defBody.matchAll(/WHEN '([A-Z]{2})' THEN '([^']+)'/g)].map(m => [m[1], m[2]]))
  const zonesBody = sql.match(/FUNCTION public\.country_time_zones[\s\S]*?\$\$([\s\S]*?)\$\$/)[1]
  const sqlMulti = Object.fromEntries([...zonesBody.matchAll(/WHEN '([A-Z]{2})' THEN ARRAY\[([\s\S]*?)\]/g)]
    .map(m => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1])]))
  const countries = Array.from(new Set([...TZ.KNOWN_TIME_ZONE_COUNTRIES, ...Object.keys(sqlDefaults), ...Object.keys(sqlMulti), 'XX', 'ZZ']))
  const diffs = []
  for (const c of countries) {
    const sqlDefault = sqlDefaults[c] ?? null
    const sqlZones = sqlMulti[c] ?? (sqlDefault ? [sqlDefault] : null)
    if (TZ.countryDefaultTimeZone(c) !== sqlDefault) diffs.push(`${c} défaut ${TZ.countryDefaultTimeZone(c)} ≠ ${sqlDefault}`)
    if (JSON.stringify(TZ.countryTimeZones(c)) !== JSON.stringify(sqlZones)) diffs.push(`${c} zones différentes`)
  }
  ok(diffs.length === 0, `${countries.length} pays comparés, aucune différence${diffs.length ? ' — ' + diffs.join(' ; ') : ''}`)
  ok(['US', 'CA', 'CD', 'ES', 'PT'].every(c => TZ.countryDefaultTimeZone(c) === null), 'US, CA, CD, ES, PT : aucun fuseau par défaut déduit du pays')
  const { COUNTRIES } = jiti(ROOT + '/lib/saas/countries.ts')
  const missing = Object.keys(COUNTRIES).filter(c => !TZ.countryTimeZones(c))
  ok(missing.length === 0, `les ${Object.keys(COUNTRIES).length} pays pris en charge ont des zones autorisées${missing.length ? ' — manquent : ' + missing.join(',') : ''}`)
}

console.log('\n2. Couple pays ↔ fuseau (règle serveur resolveShopTimeZone)')
{
  const r = (country, requested, current) => TZ.resolveShopTimeZone({ country, requested, current })
  const cases = [
    ['CM', 'Africa/Douala', true], ['CM', 'America/Chicago', false], ['US', 'America/Chicago', true], ['US', 'America/New_York', true],
    ['US', 'Europe/Paris', false], ['CD', 'Africa/Kinshasa', true], ['CD', 'Africa/Lubumbashi', true], ['CD', 'Africa/Douala', false],
    ['ES', 'Europe/Madrid', true], ['ES', 'Atlantic/Canary', true], ['ES', 'Europe/Paris', false], ['PT', 'Europe/Lisbon', true],
    ['PT', 'Atlantic/Azores', true], ['AT', 'Europe/Vienna', true], ['AT', 'Europe/Paris', false], ['CM', 'UTC+1', false], ['US', 'Etc/GMT-5', false],
  ]
  for (const [c, tz, accepted] of cases) {
    const res = r(c, tz)
    ok(accepted ? res.timezone === tz && !res.invalid : res.invalid && res.timezone === null, `${c} + ${tz} → ${accepted ? 'accepté' : 'refusé'}`)
  }
  ok(r('CM', undefined).timezone === 'Africa/Douala', 'Cameroun sans fuseau envoyé → Africa/Douala automatiquement')
  ok(r('AT', undefined).timezone === 'Europe/Vienna', 'Autriche sans fuseau envoyé → Europe/Vienna')
  ok(r('US', undefined).timezone === null && !r('US', undefined).invalid, 'US sans fuseau → aucun (refus shop_timezone_required côté serveur)')
  ok(r('FR', undefined, 'America/Chicago').timezone === 'Europe/Paris', 'changement de pays US → FR : America/Chicago remplacé par Europe/Paris (jamais France + Chicago)')
  ok(r('US', undefined, 'America/Chicago').timezone === 'America/Chicago', 'pays inchangé : fuseau actuel conservé')
  ok(r('CA', undefined, 'America/Chicago').timezone === null, 'US → CA sans nouveau choix : fuseau requis (pas d’héritage incohérent)')
  ok(TZ.suggestTimeZone('US', 'America/Chicago') === 'America/Chicago' && TZ.suggestTimeZone('US', 'Africa/Douala') === null, 'fuseau de l’appareil proposé seulement s’il appartient au pays')
  ok(TZ.countryOfTimeZone('Africa/Douala') === 'CM' && TZ.countryOfTimeZone('Europe/Paris') === 'FR', 'pays d’un fuseau sans ambiguïté (Douala → CM)')
}

console.log('\n3. Stock vendable (formule sellable_stock) — cas H1 à H6')
{
  const today = '2026-10-23'
  const lot = (q, d) => ({ quantity: q, expiry_date: d })
  const st = (p, lots) => SELL.sellableStock(p, lots, today)
  let r = st(25, [lot(20, '2026-12-01'), lot(5, '2026-10-01')])
  ok(r.sellable === 20 && r.nonSellable === 5 && r.untracked === 0, `H1 physique = lots (25 ; frais 20, périmé 5) → vendable 20, non vendable 5`)
  r = st(20, [])
  ok(r.sellable === 20 && r.nonSellable === 0, 'H5 stock sans aucun lot → tout vendable (comportement historique)')
  r = st(20, [lot(3, '2026-12-01'), lot(10, '2026-10-01')])
  ok(r.untracked === 7 && r.sellable === 10 && r.nonSellable === 10, 'H2 physique > lots (20 ; frais 3, périmé 10) → sans lot 7, vendable 10')
  r = st(10, [lot(5, '2026-12-01'), lot(12, '2026-10-01')])
  ok(r.sellable === 5 && r.nonSellable === 5, 'H3/H4 physique < lots (10 ; frais 5, périmé 12) → vendable 5 (jamais plus que le physique, frais non bloqué)')
  r = st(1473, [lot(1477, '2026-12-01'), lot(26, '2026-10-01')])
  ok(r.sellable === 1473 && r.nonSellable === 0, 'cas réel « Banane » (1473 ; frais 1477, périmé 26) → 1473 vendables')
  r = st(78, [lot(20, '2026-10-01')])
  ok(r.sellable === 58 && r.nonSellable === 20, 'cas réel « Pain de campagne » (78 ; périmé 20) → 58 vendables, 20 non vendables')
  r = st(5, [lot(5, '2026-10-01')])
  ok(r.sellable === 0 && r.nonSellable === 5, 'H6 entièrement périmé → vendable 0')
  r = st(5, [lot(5, today)])
  ok(r.sellable === 5, 'lot qui périme AUJOURD’HUI → encore vendable')
  r = st(5, [lot(5, '2026-10-22')])
  ok(r.sellable === 0, 'lot périmé HIER → exclu')
  ok(SELL.availableAfterReservations(20, 2) === 18 && SELL.availableAfterReservations(1, 5) === 0, 'disponible après réservations = vendable − réservé (25 − 5 − 2 = 18), jamais négatif')
}

console.log('\n4. Date métier : même instant, fuseaux différents')
{
  const at = new Date('2026-10-23T23:30:00Z')
  const d = tz => TZ.businessDate(tz, at)
  ok(d('Africa/Douala') === '2026-10-24' && d('Africa/Lagos') === '2026-10-24', 'Douala / Lagos (UTC+1) : 24 oct. à 00 h 30')
  ok(d('Africa/Abidjan') === '2026-10-23', 'Abidjan (UTC+0) : encore le 23 oct.')
  ok(d('Africa/Kinshasa') === '2026-10-24' && TZ.businessDate('Africa/Lubumbashi', new Date('2026-10-23T22:30:00Z')) === '2026-10-24' && TZ.businessDate('Africa/Kinshasa', new Date('2026-10-23T22:30:00Z')) === '2026-10-23',
    'Kinshasa (UTC+1) ≠ Lubumbashi (UTC+2) à 22 h 30 UTC')
  ok(d('America/New_York') === '2026-10-23' && TZ.businessDate('America/Los_Angeles', new Date('2026-10-24T05:30:00Z')) === '2026-10-23' && TZ.businessDate('America/New_York', new Date('2026-10-24T05:30:00Z')) === '2026-10-24',
    'New York ≠ Los Angeles à 05 h 30 UTC')
  ok(TZ.businessDate('Europe/Paris', new Date('2026-07-01T22:30:00Z')) === '2026-07-02' && TZ.businessDate('Europe/Paris', new Date('2026-12-01T22:30:00Z')) === '2026-12-01',
    'Paris : heure d’été (UTC+2) puis d’hiver (UTC+1) à 22 h 30 UTC')
  ok(SELL.shopToday({ timezone: 'America/Chicago', country: 'US' }, new Date('2026-10-24T03:00:00Z')) === '2026-10-23', 'shopToday lit shops.timezone (Chicago) et non le pays')
  ok(SELL.shopToday({ timezone: 'Africa/Lubumbashi', country: 'CD' }, new Date('2026-10-23T22:30:00Z')) === '2026-10-24', 'shopToday : Lubumbashi (pas de déduction depuis CD)')
}

console.log('\n5. Libellés humains')
{
  ok(TZ.zoneLabel('America/Chicago', 'fr').startsWith('Heure de Chicago'), `fr : « ${TZ.zoneLabel('America/Chicago', 'fr')} »`)
  ok(TZ.zoneLabel('Atlantic/Canary', 'fr').startsWith('Heure des Canaries'), `fr : « ${TZ.zoneLabel('Atlantic/Canary', 'fr')} »`)
  ok(TZ.zoneLabel('America/Chicago', 'en').startsWith('Chicago time'), `en : « ${TZ.zoneLabel('America/Chicago', 'en')} »`)
  ok(TZ.zoneOptions('US', 'fr').length === 7 && TZ.zoneOptions('US', 'fr', ['America/Detroit']).length === 8, 'US : 7 zones principales, + fuseau de l’appareil s’il est valable')
}

console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
