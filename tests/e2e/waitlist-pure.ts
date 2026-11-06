// Liste d'attente (lot C, migration 217) : règles communes du formulaire et du serveur (lib/site/waitlist), et accord
// avec la contrainte de la base (mêmes métiers, mêmes formats). Usage : npx tsx tests/e2e/waitlist-pure.ts
import { readFileSync } from 'fs'
import { WAITLIST_SECTORS, WAITLIST_SUB_TRADES, isSubTradeOf, isWaitlistSector, normalizeContact } from '../../lib/site/waitlist'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, x?: unknown) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x) : ''}`) }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// Contacts acceptés, mis en forme comme la base l'exige
const good: [string, unknown][] = [
  ['  Ami@Exemple.CM ', { kind: 'email', value: 'ami@exemple.cm' }],
  ['+237 699 00 11 22', { kind: 'phone', value: '+237699001122' }],
  ['0699-00-11-22', { kind: 'phone', value: '0699001122' }],
  ['00234 (803) 123.4567', { kind: 'phone', value: '+2348031234567' }],
]
for (const [raw, want] of good) ok(eq(normalizeContact(raw), want), `« ${raw.trim()} » → ${JSON.stringify(want)}`, normalizeContact(raw))
// Contacts refusés
for (const raw of ['', '   ', 'abc', 'a@b', 'ami@exemple', 'deux@@exemple.cm', 'ami @exemple.cm', '12345', '+1234567890123456', '699 abc 11', 'x'.repeat(250) + '@a.cm', null, 42]) {
  ok(normalizeContact(raw as any) === null, `refusé : ${JSON.stringify(raw).slice(0, 40)}`)
}
// Métiers et sous-métiers
ok(isWaitlistSector('health') && !isWaitlistSector('casino') && !isWaitlistSector(undefined), 'métiers connus seulement')
ok(isSubTradeOf('health', 'pharmacy') && !isSubTradeOf('health', 'garage') && !isSubTradeOf('services', 'pharmacy'), 'sous-métier lié à son métier')

// Accord avec la migration 217 : mêmes métiers, sous-métiers au format accepté, mêmes formats de contact
const sql = readFileSync(new URL('../../supabase/migrations/217_waitlist.sql', import.meta.url), 'utf8')
const dbSectors = (sql.match(/sector IN \(([^)]+)\)/) || [])[1]?.split(',').map(s => s.trim().replace(/'/g, '')) ?? []
ok(eq([...dbSectors].sort(), [...WAITLIST_SECTORS].sort()), 'mêmes métiers que la contrainte de la base', dbSectors)
ok(Object.values(WAITLIST_SUB_TRADES).flat().every(s => /^[a-z_]{2,40}$/.test(s as string)), 'sous-métiers au format accepté par la base')
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, phoneRe = /^\+?[0-9]{6,15}$/
ok(good.every(([raw]) => { const c = normalizeContact(raw)!; return c.kind === 'email' ? emailRe.test(c.value) && c.value === c.value.toLowerCase() : phoneRe.test(c.value) }), 'contacts mis en forme acceptés par la contrainte de la base')
ok(sql.includes("contact ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'") && sql.includes("contact ~ '^\\+?[0-9]{6,15}$'"), 'la base garde les mêmes formats que le serveur')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
