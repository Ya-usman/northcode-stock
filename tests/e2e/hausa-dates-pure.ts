// Dates haoussa (31 oct. 2026) : test PUR du formateur (lib/i18n/hausa-dates) et de la langue date-fns (date-fns-ha).
// Usage : npx tsx tests/e2e/hausa-dates-pure.ts
import { formatHausaDate } from '../../lib/i18n/hausa-dates'
import { ha } from '../../lib/i18n/date-fns-ha'
import { format, formatDistance } from 'date-fns'
let pass = 0, fail = 0
const ok = (got: string, exp: string, m: string) => { const c = got === exp; c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m} → « ${got} »${c ? '' : ` (attendu « ${exp} »)`}`) }
const d = new Date(Date.UTC(2026, 9, 24, 21, 57, 30)) // samedi 24 oct. 2026, 21:57 UTC
const Z = { timeZone: 'UTC' as const }
ok(formatHausaDate(d, { ...Z, weekday: 'long', day: 'numeric', month: 'long' }, 'date'), 'Asabar 24 Oktoba', 'Contrôle de caisse (jour, date, mois)')
ok(formatHausaDate(d, { ...Z, day: 'numeric', month: 'long', year: 'numeric' }, 'date'), '24 Oktoba, 2026', 'date longue')
ok(formatHausaDate(d, { ...Z, day: 'numeric', month: 'short' }, 'date'), '24 Okt', 'date courte')
ok(formatHausaDate(d, { ...Z, month: 'long', year: 'numeric' }, 'date'), 'Oktoba 2026', 'mois et année (Dépenses)')
ok(formatHausaDate(d, { ...Z, day: '2-digit', month: '2-digit', year: 'numeric' }, 'date'), '24/10/2026', 'date en chiffres')
ok(formatHausaDate(d, Z, 'date'), '24/10/2026', 'sans option : date en chiffres')
ok(formatHausaDate(d, { ...Z, hour: '2-digit', minute: '2-digit' }, 'time'), '21:57', 'heure')
ok(formatHausaDate(d, { timeZone: 'Africa/Douala', hour: '2-digit', minute: '2-digit' }, 'time'), '22:57', 'heure dans le fuseau de la boutique (Douala)')
ok(formatHausaDate(d, { ...Z, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }, 'any'), '24 Okt, 2026, 21:57', 'date et heure')
ok(formatHausaDate(d, { ...Z, dateStyle: 'medium' }, 'date'), '24 Okt, 2026', 'dateStyle medium')
ok(format(new Date(2026, 9, 24), 'd MMM', { locale: ha }), '24 Okt', 'date-fns : d MMM (Notes)')
ok(format(new Date(2026, 9, 24), 'EEEE d MMMM yyyy', { locale: ha }), 'Asabar 24 Oktoba 2026', 'date-fns : jour et mois en toutes lettres')
ok(formatDistance(new Date(2026, 9, 24, 10), new Date(2026, 9, 24, 13), { locale: ha, addSuffix: true }), 'kusan awa 3 da suka wuce', 'date-fns : « il y a environ 3 heures » (Équipe, notifications)')
ok(formatDistance(new Date(2026, 9, 26), new Date(2026, 9, 24), { locale: ha, addSuffix: true }), 'cikin kwana 2', 'date-fns : « dans 2 jours »')
const words = JSON.stringify([formatHausaDate(d, { ...Z, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, 'date')])
ok(String(/(Samedi|Saturday|octobre|October|Oct\b)/i.test(words)), 'false', 'aucun mot français ni anglais')
console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
