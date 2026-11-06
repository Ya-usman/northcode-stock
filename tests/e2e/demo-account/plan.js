// Plan de ventes déterministe (même résultat à chaque exécution) + stock de départ qui en découle.
const D = require('./data-demo.js')

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const pick = (r, pairs) => { const total = pairs.reduce((s, [, w]) => s + w, 0); let x = r() * total; for (const [v, w] of pairs) { if ((x -= w) < 0) return v } return pairs[pairs.length - 1][0] }
const dayOf = (offset) => { const d = new Date(D.D0 + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - offset); return d }   // offset = jours avant D0
const iso = d => d.toISOString().slice(0, 10)
const HOURS = [[7, 2], [8, 4], [9, 5], [10, 6], [11, 7], [12, 8], [13, 6], [14, 5], [15, 5], [16, 6], [17, 8], [18, 9], [19, 4]]
const WEEKDAY = [0.6, 0.95, 0.95, 1, 1.05, 1.15, 1.35]   // dimanche → samedi

function buildPlan(extraDay /* 'YYYY-MM-DD' facultatif : un seul jour supplémentaire */) {
  const sales = []
  D.SHOPS.forEach((shop, si) => {
    const r = rng(20261012 + si * 7919 + (extraDay ? Number(extraDay.replace(/-/g, '')) : 0))
    const products = D.PRODUCTS.filter(p => !D.NOT_IN[shop.key].includes(p.key))
    const customers = D.CUSTOMERS[shop.key]
    const creditCustomers = customers.filter(c => c.credit)
    const days = extraDay ? [null] : Array.from({ length: D.DAYS }, (_, i) => D.DAYS - 1 - i)   // 29 … 0
    for (const offset of days) {
      const date = extraDay ? new Date(extraDay + 'T00:00:00Z') : dayOf(offset)
      const progress = extraDay ? 1 : (D.DAYS - 1 - offset) / (D.DAYS - 1)
      let n = Math.round(shop.daily * WEEKDAY[date.getUTCDay()] * (0.85 + 0.3 * progress) * (0.8 + 0.4 * r()) * ((extraDay || offset === 0) ? 1.15 : 1))
      n = Math.max(2, n)
      const daySales = []
      for (let k = 0; k < n; k++) {
        const hour = pick(r, HOURS), minute = Math.floor(r() * 60), second = Math.floor(r() * 60)
        const at = new Date(date); at.setUTCHours(hour - D.TZ_OFFSET_H, minute, second, 0)
        const isCredit = creditCustomers.length > 0 && (extraDay ? false : offset <= 24) && r() < 0.04
        const customer = isCredit ? creditCustomers[Math.floor(r() * creditCustomers.length)] : (r() < 0.22 ? customers[Math.floor(r() * customers.length)] : null)
        const business = !!customer && /Restaurant|Hôtel/.test(customer.name)
        const count = business ? 4 + Math.floor(r() * 3) : pick(r, [[1, 30], [2, 30], [3, 22], [4, 12], [5, 6]])
        const pool = products.map(p => [p, p.weight])
        const items = []
        while (items.length < count && pool.length) {
          const p = pick(r, pool); pool.splice(pool.findIndex(x => x[0] === p), 1)
          let qty = ['stylo', 'eau'].includes(p.key) ? 1 + Math.floor(r() * 6) : p.weight >= 7 ? pick(r, [[1, 50], [2, 35], [3, 15]]) : pick(r, [[1, 80], [2, 20]])
          if (business) qty *= 3
          items.push({ key: p.key, name: p.name, qty, price: p.sell, cost: p.buy })
        }
        const subtotal = items.reduce((s, i) => s + i.qty * i.price, 0)
        const discount = !isCredit && subtotal >= 3000 && r() < 0.04 ? Math.max(100, Math.round(subtotal * 0.05 / 100) * 100) : 0
        const total = subtotal - discount
        let method, payments, due_date = null
        if (isCredit) {
          method = 'credit'
          const deposit = r() < 0.3 ? Math.round(total * 0.4 / 500) * 500 : 0
          payments = deposit > 0 ? [{ amount: deposit, method: 'cash' }] : []
          const due = new Date(date); due.setUTCDate(due.getUTCDate() + 15); due_date = iso(due)
        } else {
          method = pick(r, [['cash', 56], ['orange_money', 22], ['mtn_momo', 17], ['transfer', 5]])
          if (method === 'transfer' && total < 10000) method = 'cash'
          payments = [{ amount: total, method }]
        }
        daySales.push({ shop: shop.key, at: at.toISOString(), cashier: pick(r, D.CASHIERS[shop.key]), customer: customer ? customer.key : null, items, subtotal, discount, total, method, payments, due_date })
      }
      daySales.sort((a, b) => a.at.localeCompare(b.at))
      sales.push(...daySales)
    }
  })
  return sales
}

// Stock de départ = vendu + sorties par transfert + reste voulu
function initialStock(sales) {
  const out = {}
  D.SHOPS.forEach((shop, si) => {
    const r = rng(4242 + si)
    out[shop.key] = {}
    for (const p of D.PRODUCTS.filter(p => !D.NOT_IN[shop.key].includes(p.key))) {
      const sold = sales.filter(s => s.shop === shop.key).reduce((n, s) => n + s.items.filter(i => i.key === p.key).reduce((m, i) => m + i.qty, 0), 0)
      const transferred = shop.key === 'akwa' ? D.TRANSFERS.reduce((n, t) => n + t.lines.filter(l => l[0] === p.key).reduce((m, l) => m + l[1], 0), 0) : 0
      const wanted = D.REMAINDER[shop.key][p.key]
      const remainder = wanted !== undefined ? wanted : 14 + p.weight * 4 + Math.floor(r() * 20)
      out[shop.key][p.key] = { sold, transferred, remainder, initial: sold + transferred + remainder }
    }
  })
  return out
}

function summary(sales) {
  const lines = []
  const fmt = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  for (const shop of D.SHOPS) {
    const s = sales.filter(x => x.shop === shop.key)
    const today = s.filter(x => x.at.slice(0, 10) === D.D0)
    const byMethod = {}
    for (const x of s) for (const p of x.payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount
    const credit = s.filter(x => x.method === 'credit')
    const owed = credit.reduce((n, x) => n + x.total - x.payments.reduce((m, p) => m + p.amount, 0), 0)
    lines.push(`${shop.name} : ${s.length} ventes · CA ${fmt(s.reduce((n, x) => n + x.total, 0))} F CFA · panier moyen ${fmt(s.reduce((n, x) => n + x.total, 0) / s.length)} · le ${D.D0} : ${today.length} ventes, ${fmt(today.reduce((n, x) => n + x.total, 0))} F CFA`)
    lines.push(`   encaissé : ${Object.entries(byMethod).map(([m, a]) => m + ' ' + fmt(a)).join(' · ')} · ventes à crédit : ${credit.length} (reste dû ${fmt(owed)}) · remises : ${s.filter(x => x.discount > 0).length}`)
  }
  return lines
}

module.exports = { buildPlan, initialStock, summary, iso, dayOf }
