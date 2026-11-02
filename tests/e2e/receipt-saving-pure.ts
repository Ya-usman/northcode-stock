// Ticket : économie du client (prix de gros, promotion) imprimée sous la ligne et sous le total (2 nov. 2026).
// Usage : npx tsx tests/e2e/receipt-saving-pure.ts
import { buildSaleTicket, lineSaving, ticketLabelsFromT } from '../../lib/receipt/ticket'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }
const fr = require('../../messages/fr.json')
const t = (key: string, v?: Record<string, string | number>) => {
  let s = key.split('.').reduce((o: any, k) => o?.[k], fr) ?? key
  for (const [k, val] of Object.entries(v || {})) s = String(s).replace(`{${k}}`, String(val))
  return String(s)
}
const fmt = (n: number) => `${Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')} F`

console.log('1. Économie d’une ligne')
check('24 × 450 au lieu de 500 : 1 200', lineSaving({ qty: 24, unitPrice: 450, originalPrice: 500 }) === 1200)
check('prix normal inconnu : 0', lineSaving({ qty: 3, unitPrice: 450, originalPrice: null }) === 0)
check('vendu au-dessus (marchandage à la hausse) : 0', lineSaving({ qty: 3, unitPrice: 520, originalPrice: 500 }) === 0)
check('vendu au prix normal : 0', lineSaving({ qty: 3, unitPrice: 500, originalPrice: 500 }) === 0)

console.log('\n2. Ticket imprimé (80 et 58 mm)')
const data = {
  shop: { name: 'Boutique Alpha' }, saleNumber: 'BOU-9999', createdAt: '2026-11-02T10:00:00Z',
  items: [
    { name: 'Riz 1 kg', qty: 24, unitPrice: 450, subtotal: 10800, originalPrice: 500 },
    { name: 'Savon', qty: 2, unitPrice: 300, subtotal: 600, originalPrice: 300 },
  ],
  subtotal: 11400, discount: 0, tax: 0, total: 11400, amountPaid: 11400, balance: 0, paymentLabel: 'Espèces',
  fmt, labels: ticketLabelsFromT(t as any),
}
for (const w of [80, 58] as const) {
  const lines = buildSaleTicket(data as any, w)
  const text = lines.map((l: any) => l.text ?? (l.cells ? l.cells.join(' ') : `${l.left ?? ''} ${l.right ?? ''}`)).join('\n')
  check(`${w} mm : « Prix normal 500 F · économie -1 200 F » sous le riz`, /Prix normal 500 F · économie -1 200 F/.test(text), text)
  check(`${w} mm : rien sous le savon (prix normal)`, (text.match(/économie/g) || []).length === 1)
  check(`${w} mm : « Vous économisez 1 200 F » sous le total`, /Vous économisez 1 200 F/.test(text))
}
const none = buildSaleTicket({ ...data, items: [data.items[1]], subtotal: 600, total: 600, amountPaid: 600 } as any, 80)
check('aucune économie : aucune ligne « Vous économisez »', !none.some((l: any) => /Vous économisez/.test(`${l.left ?? ''}`)))

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
