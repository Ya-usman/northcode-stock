// Répartition de l'argent encaissé en caisse entre :
//   - la VENTE (lignes de paiement envoyées à complete_sale / mises en
//     file hors ligne avec la vente),
//   - le REMBOURSEMENT DE DETTE inclus dans la vente (lignes envoyées à
//     /api/payments, appliquées aux anciennes ventes impayées du client).
//
// Règle : chaque moyen de paiement doit être enregistré pour le montant
// RÉELLEMENT encaissé par ce moyen — sinon le contrôle de caisse ne tombe
// pas juste. Avant, en paiement mixte, toute la dette était imputée au
// 1er moyen (ex. 100 espèces + 1 900 MoMo encaissés pour 700 de vente +
// 1 300 de dette étaient enregistrés 1 400 espèces / 600 MoMo).

export interface PaymentLine {
  amount: number
  method: string
  reference: string | null
}

export interface CheckoutAllocation {
  /** Paiements de la vente elle-même — jamais plus que saleTotal. */
  salePayments: PaymentLine[]
  /** Paiements du remboursement de dette — total = debtAmount. */
  debtPayments: PaymentLine[]
}

/** Méthode utilisée pour un remboursement encaissé pendant une vente à
 *  crédit (le moyen "Crédit" ne désigne pas un encaissement). */
export const CREDIT_SALE_DEBT_METHOD = 'cash'

export function allocateCheckout(opts: {
  saleTotal: number
  /** Remboursement de dette, DÉJÀ plafonné à la dette réelle. */
  debtAmount: number
  paymentMethod: string
  isCredit: boolean
  /** Montant encaissé pour la vente hors paiement mixte (espèces : total
   *  plafonné ; virement/MoMo/carte : total). Ignoré si crédit ou mixte. */
  paidForSale: number
  reference: string | null
  /** Paiement mixte : montant du 1er moyen (saisi) et 2e moyen. Le 2e
   *  moyen couvre tout le reste (vente + dette). */
  split?: { amount1: number; method2: string } | null
}): CheckoutAllocation {
  const total = Math.max(0, opts.saleTotal)
  const debt = Math.max(0, opts.debtAmount)
  const salePayments: PaymentLine[] = []
  const debtPayments: PaymentLine[] = []
  const push = (list: PaymentLine[], amount: number, method: string, reference: string | null) => {
    if (amount > 0) list.push({ amount, method, reference })
  }

  if (opts.split) {
    const collected1 = Math.max(0, Math.min(opts.split.amount1, total + debt))
    const collected2 = total + debt - collected1
    // La vente est servie en premier par le 1er moyen, puis le 2e ;
    // la dette prend ce qui reste de chacun.
    const s1 = Math.min(collected1, total)
    const s2 = total - s1
    push(salePayments, s1, opts.paymentMethod, null)
    push(salePayments, s2, opts.split.method2, null)
    push(debtPayments, collected1 - s1, opts.paymentMethod, null)
    push(debtPayments, collected2 - s2, opts.split.method2, null)
  } else if (opts.isCredit) {
    // Vente à crédit : rien n'est encaissé pour la vente ; seul le
    // remboursement de dette éventuel est encaissé.
    push(debtPayments, debt, CREDIT_SALE_DEBT_METHOD, null)
  } else {
    push(salePayments, Math.min(opts.paidForSale, total), opts.paymentMethod, opts.reference)
    push(debtPayments, debt, opts.paymentMethod, opts.reference)
  }

  return { salePayments, debtPayments }
}

/** Dette réellement remboursable = somme des soldes des ventes impayées
 *  (c'est sur elles seules que /api/payments répartit le remboursement). */
export function outstandingDebt(unpaidSales: Array<{ balance: number | string }>): number {
  return unpaidSales.reduce((s, x) => s + Math.max(0, Number(x.balance) || 0), 0)
}
