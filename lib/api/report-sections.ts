// ── Sections des rapports et du tableau de bord autorisées, boutique par boutique (règle pure, testable) ─────────
// Décidé par le SERVEUR (lib/api/shop-access) : aucune section n'est calculée pour une boutique où la personne n'y
// a pas droit, et aucun paramètre du navigateur ne peut élargir le périmètre.
//   • Rapports accessibles + canViewCost → marge / bénéfice / coûts (route /api/reports/margin) ;
//   • Rapports accessibles sans canViewCost → chiffre d'affaires, ventes, volumes, paiements… ni coût ni marge ;
//   • canViewCost seul → aucun accès aux Rapports.

import type { ShopAccess } from '@/lib/api/shop-access'

export interface ReportSections {
  encaisse: boolean
  transactions: boolean
  paymentChart: boolean
  topProducts: boolean
  depenses: boolean
  credits: boolean
  cashierPerf: boolean
  /** Inventaire et valeur de vente du stock : accès aux Rapports (aucun coût) */
  inventory: boolean
  /** Marge, bénéfice, coût des ventes, valeur d'achat : Rapports + coûts */
  margin: boolean
  /** Le vendeur ne voit que SES ventes et sa propre ligne (caissier sans « chiffre d'affaires de la boutique ») */
  ownSalesOnly: boolean
}

export function reportSections(a: ShopAccess): ReportSections | null {
  if (!a.view('reports')) return null
  return {
    encaisse: a.view('widget_rep_encaisse'),
    transactions: a.view('widget_rep_transactions'),
    paymentChart: a.view('widget_rep_payment_chart'),
    topProducts: a.view('widget_rep_top_products'),
    depenses: a.view('widget_rep_depenses'),
    credits: a.view('widget_rep_credits'),
    cashierPerf: a.view('widget_rep_cashier_perf'),
    inventory: true,
    margin: a.cost && (a.view('widget_rep_marge_brute') || a.view('widget_rep_benefice_net')),
    ownSalesOnly: a.role === 'cashier' && !a.view('revenue_chart'),
  }
}
