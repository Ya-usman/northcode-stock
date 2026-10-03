// Montants suggérés pour un encaissement en ESPÈCES (boutons rapides en
// caisse) : le total arrondi au billet supérieur, pour les coupures
// réellement en circulation dans la devise de la boutique. Le bouton
// "Montant exact" est géré à part par l'appelant.
//
// Coupures = billets courants (pas les pièces) — volontairement limité aux
// devises où StockShop a des boutiques ou une facturation ; les autres
// retombent sur une suite générique 1-2-5 × 10^k.

const BILLS: Record<string, number[]> = {
  XAF: [500, 1000, 2000, 5000, 10000],
  XOF: [500, 1000, 2000, 5000, 10000],
  NGN: [100, 200, 500, 1000],
  GHS: [1, 2, 5, 10, 20, 50, 100, 200],
  GNF: [1000, 2000, 5000, 10000, 20000],
  CDF: [500, 1000, 5000, 10000, 20000],
  EUR: [5, 10, 20, 50, 100],
  USD: [1, 5, 10, 20, 50, 100],
  CAD: [5, 10, 20, 50, 100],
}

function genericBills(total: number): number[] {
  const out: number[] = []
  for (let k = 0; k <= 9; k++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** k
      out.push(v)
      if (v > total) return out
    }
  }
  return out
}

/**
 * Jusqu'à `max` montants strictement supérieurs au total, chacun = le total
 * arrondi au multiple supérieur d'un billet, triés et sans doublon.
 *   cashSuggestions(700, 'XAF')    → [1000, 2000, 5000]
 *   cashSuggestions(4500, 'XAF')   → [5000, 6000, 10000]
 */
export function cashSuggestions(total: number, currency: string, max = 3): number[] {
  if (!Number.isFinite(total) || total <= 0) return []
  const bills = BILLS[currency] ?? genericBills(total)
  const values = new Set<number>()
  for (const b of bills) {
    const v = Math.ceil(total / b) * b
    if (v > total) values.add(v)
  }
  return Array.from(values).sort((a, b) => a - b).slice(0, max)
}
