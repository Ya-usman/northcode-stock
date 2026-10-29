// Horaires de boutique (29 oct. 2026) — règle d'ouverture à l'heure de la BOUTIQUE (fuseau), dérogation, prolongation,
// « en cas de doute : ouvert », compte à rebours. Test PUR. Usage : node tests/e2e/shop-hours-pure.mjs
const H = await import(new URL('../../lib/saas/shop-hours.ts', import.meta.url).href)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
const at = iso => new Date(iso)
const open = (now, tz, o = {}) => H.isShopOpenNow(o.enabled ?? true, 'opening' in o ? o.opening : '08:00:00', 'closing' in o ? o.closing : '20:00:00', o.override ?? null, o.ext ?? null, now, tz)

// Douala (UTC+1, pas d'heure d'été) : 08:00–20:00 locales = 07:00–19:00 UTC
ok(open(at('2026-10-29T06:59:00Z'), 'Africa/Douala') === false, 'Douala 07:59 locale : fermée (avant 08:00)')
ok(open(at('2026-10-29T07:00:00Z'), 'Africa/Douala') === true, 'Douala 08:00 locale : ouverte (ouverture incluse)')
ok(open(at('2026-10-29T18:59:00Z'), 'Africa/Douala') === true, 'Douala 19:59 locale : ouverte')
ok(open(at('2026-10-29T19:00:00Z'), 'Africa/Douala') === false, 'Douala 20:00 locale : fermée (fermeture exclue)')
// Abidjan (UTC+0) : le même instant n'a pas la même réponse qu'à Douala
ok(open(at('2026-10-29T19:30:00Z'), 'Africa/Abidjan') === true && open(at('2026-10-29T19:30:00Z'), 'Africa/Douala') === false,
   '19:30 UTC : ouverte à Abidjan (19:30), fermée à Douala (20:30) — fuseau de la BOUTIQUE, pas celui de l’appareil')
// Paris, heure d'hiver (UTC+1 depuis le 25 oct.) puis d'été (UTC+2)
ok(open(at('2026-10-29T19:30:00Z'), 'Europe/Paris') === false, 'Paris en hiver, 20:30 locale : fermée')
ok(open(at('2026-07-01T17:30:00Z'), 'Europe/Paris') === true && open(at('2026-07-01T18:30:00Z'), 'Europe/Paris') === false, 'Paris en été (UTC+2) : 19:30 ouverte, 20:30 fermée')

// Dérogation manuelle et prolongation
ok(open(at('2026-10-29T22:00:00Z'), 'Africa/Douala', { override: 'open' }) === true, 'dérogation « ouverte » : ouverte la nuit')
ok(open(at('2026-10-29T12:00:00Z'), 'Africa/Douala', { override: 'closed' }) === false, 'dérogation « fermée » : fermée en pleine journée')
ok(open(at('2026-10-29T19:20:00Z'), 'Africa/Douala', { ext: '2026-10-29T19:30:00Z' }) === true, 'prolongation jusqu’à 20:30 locale : ouverte à 20:20')
ok(open(at('2026-10-29T19:40:00Z'), 'Africa/Douala', { ext: '2026-10-29T19:30:00Z' }) === false, 'prolongation dépassée : fermée à 20:40')
ok(open(at('2026-10-30T19:20:00Z'), 'Africa/Douala', { ext: '2026-10-29T19:30:00Z' }) === false, 'prolongation de la veille : ignorée')

// En cas de doute : ouverte
ok(open(at('2026-10-29T23:00:00Z'), 'Africa/Douala', { enabled: false }) === true, 'horaires désactivés : toujours ouverte')
ok(open(at('2026-10-29T23:00:00Z'), 'Africa/Douala', { opening: null }) === true, 'heure d’ouverture absente : ouverte')
ok(open(at('2026-10-29T23:00:00Z'), 'Africa/Douala', { opening: '22:00', closing: '02:00' }) === true, 'horaires traversant minuit (non gérés) : ouverte')
ok(open(at('2026-10-29T23:00:00Z'), 'Pas/UnFuseau') === open(at('2026-10-29T23:00:00Z'), null), 'fuseau invalide : même résultat que sans fuseau (heure de l’appareil)')

// Sans fuseau : ancien comportement (heure de l'appareil) inchangé
const d = new Date(); d.setHours(12, 0, 0, 0)
const n = new Date(); n.setHours(21, 0, 0, 0)
ok(open(d, undefined) === true && open(n, undefined) === false, 'sans fuseau : heure de l’appareil (12:00 ouverte, 21:00 fermée), comme avant')

// Compte à rebours à l'heure de la boutique
const ms = H.getMsUntilClosing(true, '08:00', '20:00', null, null, at('2026-10-29T18:30:00Z'), 'Africa/Douala')
ok(ms === 30 * 60_000, `Douala 19:30 locale : fermeture dans 30 min (${ms / 60_000} min)`)
const msExt = H.getMsUntilClosing(true, '08:00', '20:00', null, '2026-10-29T19:30:00Z', at('2026-10-29T18:30:00Z'), 'Africa/Douala')
ok(msExt === 60 * 60_000, `avec prolongation à 20:30 : fermeture dans 60 min (${msExt / 60_000} min)`)

// Carte de demande : « Accepter jusqu'à HH:MM » = même calcul que grant_hours_extension (migration 186)
const P = (nowIso, min, ext = null) => H.projectedExtensionEnd('20:00:00', ext, min, at(nowIso), 'Africa/Douala')
const hm = r => r && new Date(r.until).toISOString().slice(11, 16)
ok(hm(P('2026-10-29T18:30:00Z', 60)) === '20:00', 'avant la fermeture (19:30) : +1 h à partir de 20:00, soit 21:00 locale (20:00 UTC)')
ok(hm(P('2026-10-29T19:35:00Z', 60)) === '20:35', 'après la fermeture (20:35) : +1 h à partir de MAINTENANT, soit 21:35 locale')
ok(hm(P('2026-10-29T19:35:00Z', 30, '2026-10-29T20:00:00Z')) === '20:30', 'prolongation en cours jusqu’à 21:00 : +30 min à partir de 21:00')
const cap = P('2026-10-29T22:00:00Z', 120)
ok(hm(cap) === '22:59' && cap.capped === true, 'à 23:00 locale, +2 h : plafond 23:59 locale, signalé')
ok(P('2026-10-29T22:59:00Z', 30) === null, 'à 23:59 locale : trop tard (la base refuserait, P0054)')
ok(H.projectedExtensionEnd(null, null, 60, at('2026-10-29T19:35:00Z'), 'Africa/Douala') === null, 'heure de fermeture absente : aucun calcul')
const ec = H.effectiveCloseInstant('20:00:00', null, at('2026-10-29T19:35:00Z'), 'Africa/Douala')
ok(new Date(ec).toISOString().slice(11, 16) === '19:00', 'fermeture effective du jour : 20:00 locale (19:00 UTC)')

console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
