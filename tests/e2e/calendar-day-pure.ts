// Jours du calendrier des périodes (dépenses des Rapports et du tableau de bord) : lib/dates/calendar-day.
// Défaut corrigé le 6 nov. 2026 : la borne UTC coupée donnait la VEILLE à l'est de UTC (Douala, Lagos…).
// Usage : npx tsx tests/e2e/calendar-day-pure.ts
import { readFileSync } from 'fs'
import { calendarDay, startDayAfterClamp } from '../../lib/dates/calendar-day'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, x?: unknown) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x) : ''}`) }

// Bornes d'une journée locale (le 6 nov. 2026) telles que le navigateur les envoie, selon le fuseau
const ZONES: [string, number][] = [['Douala / Lagos (UTC+1)', 1], ['Paris été (UTC+2)', 2], ['Nairobi (UTC+3)', 3], ['Abidjan / Dakar (UTC)', 0],
  ['New York (UTC−5)', -5], ['Los Angeles (UTC−8)', -8], ['Auckland (UTC+12)', 12], ['Pago Pago (UTC−11)', -11]]
for (const [name, h] of ZONES) {
  const start = new Date(Date.UTC(2026, 10, 6, 0, 0, 0) - h * 3600e3).toISOString()
  const end = new Date(Date.UTC(2026, 10, 6, 23, 59, 59, 999) - h * 3600e3).toISOString()
  ok(calendarDay(null, start, 'start') === '2026-11-06' && calendarDay(null, end, 'end') === '2026-11-06',
    `${name} : « Aujourd'hui » = 6 nov., sans le jour envoyé (anciennes versions)`, [calendarDay(null, start, 'start'), calendarDay(null, end, 'end')])
}
// Mois de novembre vu de Douala : le 31 octobre n'en fait plus partie
ok(calendarDay(null, '2026-10-31T23:00:00.000Z', 'start') === '2026-11-01', 'début de mois à Douala : 1er nov. (avant : 31 oct.)')
ok(calendarDay(null, '2026-11-30T22:59:59.999Z', 'end') === '2026-11-30', 'fin de mois à Douala : 30 nov.')
// Le jour envoyé par l'écran fait foi
ok(calendarDay('2026-11-06', '2026-11-05T23:00:00.000Z', 'start') === '2026-11-06', 'jour explicite de l\'écran utilisé')
for (const bad of ['2026-13-01', '2026-02-30', '06/11/2026', "2026-11-06' OR 1=1", '']) {
  ok(calendarDay(bad, '2026-11-05T23:00:00.000Z', 'start') === '2026-11-06', `jour invalide ignoré (${JSON.stringify(bad)}) : déduit de l'instant`)
}
// Plafond d'historique de la formule : le jour du plafond l'emporte s'il est plus récent
ok(startDayAfterClamp('2026-01-01', '2025-12-31T23:00:00.000Z', '2026-08-08T15:00:00.000Z') === '2026-08-08', 'début relevé par la formule : jour du plafond')
ok(startDayAfterClamp('2026-11-01', '2026-10-31T23:00:00.000Z', '2026-10-31T23:00:00.000Z') === '2026-11-01', 'début non relevé : jour de l\'écran')

// Branchements : plus aucune borne UTC coupée pour filtrer les dépenses ; les écrans envoient leurs jours locaux
const src = (f: string) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
for (const f of ['app/api/reports/summary/route.ts', 'app/api/dashboard/summary/route.ts', 'app/api/dashboard/expense-revenue/route.ts']) {
  ok(!/\.(gte|lte)\('date', [a-zA-Z]+\.slice\(0, 10\)\)/.test(src(f)) && /calendarDay\(/.test(src(f)), `${f} : jour du calendrier, jamais la date UTC coupée`)
}
ok(/start_day: format\(new Date\(start\), 'yyyy-MM-dd'\)/.test(src('app/[locale]/(app)/reports/page.tsx')), 'Rapports : jours locaux envoyés')
ok(/month_start_day: format\(startOfMonth\(today\), 'yyyy-MM-dd'\)/.test(src('app/[locale]/(app)/dashboard/page.tsx')), 'tableau de bord : jours locaux du mois envoyés')
ok(/from_day: format\(sixMonthsAgo, 'yyyy-MM-dd'\)/.test(src('components/dashboard/expense-revenue-chart.tsx')), 'graphique revenus / dépenses : jours locaux envoyés')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
