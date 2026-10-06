// Tours guidés « Bien démarrer » (lot A) — courts (3 à 7 étapes), sur les
// vrais écrans. Chaque étape :
//  - path : page où elle se joue (la page est ouverte si besoin) ;
//  - targets : éléments à éclairer, le PREMIER VISIBLE l'emporte (ordinateur
//    / téléphone, menu ouvert / fermé…) ; aucun = bulle centrée ;
//  - waitFor : l'étape avance sur une action réelle (événement de l'écran ou
//    apparition d'un élément) au lieu du bouton « Suivant » ;
//  - backTo : si les éléments éclairés disparaissent (formulaire fermé…),
//    retour à cette étape.
// Les textes sont dans messages/*.json, espace « onboarding.tours.<tour>.<étape> ».

import type { OnboardingEvent } from './events'

export type TourId = 'quick_tour' | 'add_product' | 'first_sale'
export const TOUR_IDS: TourId[] = ['quick_tour', 'add_product', 'first_sale']

export interface TourStep {
  id: string
  path?: string
  targets?: string[]
  waitFor?: { event?: OnboardingEvent; selector?: string }
  backTo?: number
  /** Étape finale : propose d'enchaîner sur un autre tour */
  next?: TourId
}

const nav = (slug: string) => `[data-tour="nav-${slug}"]`

export const TOURS: Record<TourId, TourStep[]> = {
  quick_tour: [
    { id: 'intro' },
    { id: 'sell', targets: [nav('sales-new')] },
    { id: 'stock', targets: [nav('stock')] },
    { id: 'history', targets: [nav('sales-history'), nav('more')] },
    { id: 'reports', targets: [nav('reports'), nav('more')] },
    { id: 'help', targets: ['[data-testid="whats-new-button"]'] },
    { id: 'done', next: 'add_product' },
  ],
  add_product: [
    {
      id: 'open', path: 'stock/products',
      targets: ['[data-tour="add-product-item"]', '[data-tour="add-product-menu"]'],
      waitFor: { selector: '[data-testid="product-drawer"]' },
    },
    { id: 'name', targets: ['[data-tour="product-name"]'], backTo: 0 },
    { id: 'prices', targets: ['[data-tour="product-prices"]'], backTo: 0 },
    { id: 'stock', targets: ['[data-tour="product-stock"]'], backTo: 0 },
    { id: 'save', targets: ['[data-testid="product-drawer"] [data-testid="drawer-submit"]'], waitFor: { event: 'product_created' }, backTo: 0 },
    { id: 'done', next: 'first_sale' },
  ],
  first_sale: [
    { id: 'pick', path: 'sales/new', targets: ['[data-tour="pos-grid"]'], waitFor: { event: 'cart_item_added' } },
    {
      id: 'pay',
      // Ordinateur : « Valider » ; téléphone : ouvrir le panier → « Encaisser » → « Valider »
      targets: ['[data-tour="pos-checkout"]', '[data-tour="pos-collect"]', '[data-tour="pos-open-cart"]'],
      waitFor: { event: 'sale_completed' },
    },
    { id: 'done' },
  ],
}
