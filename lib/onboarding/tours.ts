// Tours guidés « Bien démarrer » — courts, sur les vrais écrans, et qui
// MONTRENT LE CHEMIN : un tour ne change jamais de page tout seul. Il éclaire
// l'entrée du menu (sur téléphone : d'abord « Plus » si l'entrée y est rangée),
// puis le sous-onglet, puis le bouton, et attend que la personne les touche.
// Déjà sur la bonne page (lien d'un e-mail, « Y aller ») : les étapes de
// chemin sont sautées toutes seules.
//
// Chaque étape :
//  - targets : éléments à éclairer, le PREMIER VISIBLE l'emporte (ordinateur /
//    téléphone, menu ouvert / fermé…) ; aucun = bulle centrée ;
//  - waitFor : l'étape avance sur une action réelle — événement de l'écran,
//    apparition d'un élément, ou arrivée sur une page (path) ;
//  - page : page où se joue l'étape ; si la personne la quitte, retour à
//    l'étape `leaveTo` (le chemin) au lieu de la ramener de force ;
//  - backTo : si les éléments éclairés disparaissent sur la page (formulaire
//    fermé…), retour à cette étape ;
//  - next : étape finale, propose d'enchaîner sur un autre tour.
// Textes : messages/*.json, « onboarding.tours.<tour>.<étape> ».

import type { OnboardingEvent } from './events'

export type TourId = 'quick_tour' | 'add_product' | 'first_sale' | 'add_category' | 'invite_member' | 'customize_receipt'
  | 'opening_balance' | 'import_customers' | 'import_products'
export const TOUR_IDS: TourId[] = ['quick_tour', 'add_product', 'first_sale', 'add_category', 'invite_member', 'customize_receipt', 'opening_balance', 'import_customers', 'import_products']

export interface TourStep {
  id: string
  targets?: string[]
  waitFor?: { event?: OnboardingEvent; selector?: string; path?: string }
  page?: string
  leaveTo?: number
  backTo?: number
  next?: TourId
}

const nav = (slug: string) => `[data-tour="nav-${slug}"]`
const MORE = nav('more') // téléphone : entrée rangée dans « Plus »

export const TOURS: Record<TourId, TourStep[]> = {
  quick_tour: [
    { id: 'intro' },
    { id: 'sell', targets: [nav('sales-new')] },
    { id: 'stock', targets: [nav('stock')] },
    { id: 'history', targets: [nav('sales-history'), MORE] },
    { id: 'reports', targets: [nav('reports'), MORE] },
    { id: 'help', targets: ['[data-testid="whats-new-button"]'] },
    { id: 'done', next: 'add_product' },
  ],
  add_product: [
    { id: 'nav', targets: [nav('stock')], waitFor: { path: 'stock' } },
    { id: 'tab', targets: ['[data-tour="stock-tab-products"]'], waitFor: { path: 'stock/products' }, page: 'stock', leaveTo: 0 },
    {
      id: 'open', page: 'stock/products', leaveTo: 0,
      targets: ['[data-tour="add-product-item"]', '[data-tour="add-product-menu"]'],
      waitFor: { selector: '[data-testid="product-drawer"]' },
    },
    { id: 'name', page: 'stock/products', leaveTo: 0, targets: ['[data-tour="product-name"]'], backTo: 2 },
    { id: 'prices', page: 'stock/products', leaveTo: 0, targets: ['[data-tour="product-prices"]'], backTo: 2 },
    { id: 'stock', page: 'stock/products', leaveTo: 0, targets: ['[data-tour="product-stock"]'], backTo: 2 },
    { id: 'save', page: 'stock/products', leaveTo: 0, targets: ['[data-testid="product-drawer"] [data-testid="drawer-submit"]'], waitFor: { event: 'product_created' }, backTo: 2 },
    { id: 'done', next: 'first_sale' },
  ],
  first_sale: [
    { id: 'nav', targets: [nav('sales-new')], waitFor: { path: 'sales/new' } },
    { id: 'pick', page: 'sales/new', leaveTo: 0, targets: ['[data-tour="pos-grid"]'], waitFor: { event: 'cart_item_added' } },
    {
      id: 'pay', page: 'sales/new', leaveTo: 0,
      // Ordinateur : « Valider » ; téléphone : ouvrir le panier → « Encaisser » → « Valider »
      targets: ['[data-tour="pos-checkout"]', '[data-tour="pos-collect"]', '[data-tour="pos-open-cart"]'],
      waitFor: { event: 'sale_completed' },
    },
    { id: 'done' },
  ],
  add_category: [
    { id: 'nav', targets: [nav('categories'), MORE], waitFor: { path: 'categories' } },
    { id: 'open', page: 'categories', leaveTo: 0, targets: ['[data-tour="add-category"]'], waitFor: { selector: '[data-testid="category-dialog"]' } },
    { id: 'name', page: 'categories', leaveTo: 0, targets: ['#cat-name'], backTo: 1 },
    { id: 'save', page: 'categories', leaveTo: 0, targets: ['[data-testid="category-dialog"] [data-tone]'], waitFor: { event: 'category_created' }, backTo: 1 },
    { id: 'done' },
  ],
  invite_member: [
    { id: 'nav', targets: [nav('team'), MORE], waitFor: { path: 'team' } },
    { id: 'open', page: 'team', leaveTo: 0, targets: ['[data-testid="team-invite"]'], waitFor: { selector: '[data-testid="invite-dialog"]' } },
    { id: 'identity', page: 'team', leaveTo: 0, targets: ['[data-tour="invite-identity"]'], backTo: 1 },
    { id: 'role', page: 'team', leaveTo: 0, targets: ['[data-testid="invite-role"]'], backTo: 1 },
    { id: 'send', page: 'team', leaveTo: 0, targets: ['[data-testid="invite-dialog"] [data-tone]'], waitFor: { event: 'member_invited' }, backTo: 1 },
    { id: 'done' },
  ],
  customize_receipt: [
    { id: 'nav', targets: [nav('settings'), MORE], waitFor: { path: 'settings' } },
    { id: 'logo', page: 'settings', leaveTo: 0, targets: ['[data-tour="settings-logo"]'] },
    { id: 'texts', page: 'settings', leaveTo: 0, targets: ['[data-tour="settings-receipt"]'] },
    { id: 'save', page: 'settings', leaveTo: 0, targets: ['[data-tour="settings-save"]'], waitFor: { event: 'settings_saved' } },
    { id: 'done' },
  ],
  // Nouveautés d'octobre 2026 (« Me montrer » depuis l'annonce, ou Aide › Tours guidés)
  opening_balance: [
    { id: 'nav', targets: [nav('payments'), MORE], waitFor: { path: 'payments' } },
    { id: 'open', page: 'payments', leaveTo: 0, targets: ['[data-testid="opening-open"]'], waitFor: { selector: '[data-testid="opening-drawer"]' } },
    { id: 'party', page: 'payments', leaveTo: 0, targets: ['[data-tour="opening-party"]'], backTo: 1 },
    { id: 'amount', page: 'payments', leaveTo: 0, targets: ['[data-tour="opening-amount"]'], backTo: 1 },
    { id: 'save', page: 'payments', leaveTo: 0, targets: ['[data-testid="opening-drawer"] [data-testid="drawer-submit"]'], waitFor: { event: 'opening_created' }, backTo: 1 },
    { id: 'done' },
  ],
  import_customers: [
    { id: 'nav', targets: [nav('customers'), MORE], waitFor: { path: 'customers' } },
    {
      id: 'open', page: 'customers', leaveTo: 0,
      targets: ['[data-testid="customers-import"]', '[data-testid="customers-files"]'],
      waitFor: { selector: '[data-testid="import-drawer"]' },
    },
    { id: 'template', page: 'customers', leaveTo: 0, targets: ['[data-testid="import-template"]'], backTo: 1 },
    { id: 'file', page: 'customers', leaveTo: 0, targets: ['[data-tour="import-file"]'], backTo: 1 },
    { id: 'done' },
  ],
  import_products: [
    { id: 'nav', targets: [nav('stock')], waitFor: { path: 'stock' } },
    { id: 'tab', targets: ['[data-tour="stock-tab-products"]'], waitFor: { path: 'stock/products' }, page: 'stock', leaveTo: 0 },
    {
      id: 'open', page: 'stock/products', leaveTo: 0,
      targets: ['[data-tour="add-product-import"]', '[data-tour="add-product-menu"]'],
      waitFor: { selector: '[data-testid="import-drawer"]' },
    },
    { id: 'template', page: 'stock/products', leaveTo: 0, targets: ['[data-testid="import-template"]'], backTo: 2 },
    { id: 'file', page: 'stock/products', leaveTo: 0, targets: ['[data-tour="import-file"]'], backTo: 2 },
    { id: 'done' },
  ],
}

/** La page courante (sans langue) est `p` ou une de ses sous-pages */
export const onAppPage = (current: string, p: string) => current === p || current.startsWith(p + '/')
