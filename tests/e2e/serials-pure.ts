// Numéros de série, règles serveur pures (étape 11, 1er nov. 2026) : npx tsx tests/e2e/serials-pure.ts
import { cleanSerials, withCleanSerials, serialErrorResponse } from '../../lib/api/serials'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }

check('liste : espaces retirés, vides écartés', JSON.stringify(cleanSerials([' IMEI-1 ', '', '  ', 'IMEI-2'])) === '["IMEI-1","IMEI-2"]')
check('texte : un par ligne, virgules et points-virgules acceptés', JSON.stringify(cleanSerials('A1\nA2, A3;A4\r\nA5')) === '["A1","A2","A3","A4","A5"]')
check('nombres acceptés (IMEI lus comme nombres)', JSON.stringify(cleanSerials([356938035643809])) === '["356938035643809"]')
check('rien → liste vide', JSON.stringify(cleanSerials(undefined)) === '[]' && JSON.stringify(cleanSerials(null)) === '[]')
check('forme invalide (objet) → refus', cleanSerials({ a: 1 }) === null)
check('numéro de plus de 64 caractères → refus', cleanSerials(['x'.repeat(65)]) === null)
check('plus de 500 numéros → refus', cleanSerials(Array.from({ length: 501 }, (_, i) => `S${i}`)) === null)
const lines = withCleanSerials([{ product_id: 'a', serials: [' S1 ', ''] }, { product_id: 'b', serials: [] }, { product_id: 'c' }] as any[])
check('lignes de vente : numéros propres gardés, liste vide retirée', JSON.stringify(lines) === '[{"product_id":"a","serials":["S1"]},{"product_id":"b"},{"product_id":"c"}]', lines)

const t = (k: string, v?: any) => `${k}${v?.serial ? ':' + v.serial : ''}`
const e = (code: string, details = 'IMEI-9') => serialErrorResponse({ code, details }, t)
check('P0041 → nombre de numéros', e('P0041')?.body.code === 'serial_count_mismatch' && e('P0041')?.status === 400)
check('P0042 → déjà pris (409), numéro cité', e('P0042')?.status === 409 && e('P0042')?.body.error === 'serial_taken:IMEI-9')
check('P0046 → pas en stock, numéro renvoyé', e('P0046')?.body.code === 'serial_not_in_stock' && e('P0046')?.body.serial === 'IMEI-9')
check('P0044, P0045, P0047 traduits', e('P0044')?.body.code === 'serial_duplicate_input' && e('P0045')?.body.code === 'serial_exceeds_stock' && e('P0047')?.body.code === 'serial_product_not_tracked')
check('autre erreur (P0001 stock) : non concernée', e('P0001') === null)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
