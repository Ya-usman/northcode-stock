// Compte de démonstration : même contenu que la vitrine Marché Soleil (data.js), sur 90 jours jusqu'à la veille,
// avec les charges récurrentes de chaque mois (loyers, salaires, factures) et les petites dépenses de la période.
const base = require('./data.js')

// Dernier jour rempli = la veille (heure de Douala). L'activité du jour vient de la tâche planifiée (migration 216).
function yesterdayDouala() {
  const now = new Date(Date.now() + 3600e3)        // Douala = UTC+1 toute l'année
  now.setUTCDate(now.getUTCDate() - 1)
  return now.toISOString().slice(0, 10)
}
const D0 = process.env.DEMO_D0 || yesterdayDouala()
const DAYS = 90

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const de = m => (/^[aeiouéè]/.test(m) ? "d'" : 'de ') + m
const d0 = new Date(D0 + 'T00:00:00Z')
const before = d => Math.round((d0 - d) / 864e5)
const inRange = d => before(d) >= 0 && before(d) < DAYS

// Charges récurrentes : [jour du mois, boutique, catégorie, libellé (mois), montant, moyen]
const MONTHLY = [
  [3, 'akwa', 'internet', () => 'Abonnement internet', 15000, 'mobile_money'],
  [5, 'akwa', 'rent', m => 'Loyer de la boutique, ' + m, 150000, 'bank_transfer'],
  [5, 'bonapriso', 'rent', m => 'Loyer de la boutique, ' + m, 120000, 'bank_transfer'],
  [5, 'bastos', 'rent', m => 'Loyer de la boutique, ' + m, 100000, 'bank_transfer'],
  [12, 'akwa', 'electricity', () => "Facture d'électricité", 28500, 'mobile_money'],
  [12, 'bonapriso', 'electricity', () => "Facture d'électricité", 19000, 'mobile_money'],
  [12, 'bastos', 'electricity', () => "Facture d'électricité", 14500, 'mobile_money'],
  [14, 'akwa', 'water', () => "Facture d'eau", 9500, 'mobile_money'],
  [28, 'akwa', 'salaries', m => 'Salaires ' + de(m), 180000, 'bank_transfer'],
  [28, 'bonapriso', 'salaries', m => 'Salaires ' + de(m), 90000, 'bank_transfer'],
]
// Petites dépenses variables : [boutique, tous les n jours, décalage, catégorie, libellé, montant]
const VARIABLE = [
  ['akwa', 6, 1, 'transport', 'Transport de marchandises', 5000],
  ['akwa', 9, 4, 'supplies', 'Sacs et emballages', 6000],
  ['akwa', 15, 7, 'supplies', 'Rouleaux de caisse', 4500],
  ['akwa', 30, 13, 'maintenance', 'Entretien du congélateur', 15000],
  ['akwa', 30, 20, 'marketing', 'Affiches et promotions', 10000],
  ['bonapriso', 8, 3, 'transport', 'Transport de marchandises', 4000],
  ['bastos', 10, 5, 'transport', 'Transport de marchandises', 3500],
]

const EXPENSES = []
const months = []
for (let i = 0; i < 5; i++) { const m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)); months.push(m) }
for (const m of months) for (const [day, shop, category, label, amount, method] of MONTHLY) {
  const d = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), day))
  if (inRange(d)) EXPENSES.push([shop, category, label(MONTHS[m.getUTCMonth()]), amount, before(d), method])
}
for (const [shop, every, offset, category, label, amount] of VARIABLE) {
  for (let b = offset; b < DAYS; b += every) EXPENSES.push([shop, category, label, amount + ((b * 37) % 5) * 500, b, 'cash'])
}
EXPENSES.sort((a, b) => b[4] - a[4])

// Rythme doublé par rapport à la vitrine : trois boutiques avec loyers et salaires doivent rester rentables
const DAILY = { akwa: 26, bonapriso: 15, bastos: 9 }
const SHOPS = base.SHOPS.map(s => ({ ...s, daily: DAILY[s.key] }))

module.exports = { ...base, D0, DAYS, EXPENSES, SHOPS }
