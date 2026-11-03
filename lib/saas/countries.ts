export type CountryCode =
  | 'NG' | 'CM' | 'CI' | 'ML' | 'NE' | 'SN' | 'BJ' | 'TG'
  | 'GH' | 'BF' | 'GN' | 'GW' | 'GM' | 'SL' | 'LR' | 'CV' | 'MR'
  | 'CD' | 'CG' | 'GA' | 'GQ' | 'CF' | 'TD'
  | 'US' | 'CA'
  // Union européenne — 27 pays individuels (jamais groupés sous "Europe" :
  // l'UE n'est pas la zone euro, voir COUNTRIES ci-dessous et euCountry()).
  | 'DE' | 'AT' | 'BE' | 'BG' | 'HR' | 'CY' | 'DK' | 'ES' | 'EE' | 'FI'
  | 'FR' | 'GR' | 'HU' | 'IE' | 'IT' | 'LV' | 'LT' | 'LU' | 'MT' | 'NL'
  | 'PL' | 'PT' | 'CZ' | 'RO' | 'SK' | 'SI' | 'SE'
  // Nouveaux pays (tarification du 3 nov. 2026, tableau validé) : Afrique de l'Est et du Nord, Asie, Amériques, Europe hors UE
  | 'KE' | 'UG' | 'TZ' | 'RW' | 'ET' | 'MA' | 'TN' | 'DZ' | 'EG' | 'ZA' | 'IN' | 'PK'
  | 'BD' | 'PH' | 'ID' | 'VN' | 'NP' | 'LK' | 'KH' | 'MM' | 'CN' | 'MY' | 'TH' | 'JP'
  | 'KR' | 'SG' | 'AE' | 'SA' | 'BR' | 'MX' | 'CL' | 'CO' | 'PE' | 'AR' | 'UY' | 'EC'
  | 'PA' | 'CR' | 'BO' | 'GT' | 'HN' | 'HT' | 'SV' | 'VE' | 'GB' | 'CH'

// Durées d'abonnement (tarification du 3 nov. 2026) : mensuel ; 6 mois = 2 semaines offertes (5,5 mois payés) ;
// 1 an = 2 mois offerts (10 mois payés). Le trimestre n'est plus proposé : gardé pour lire les abonnements déjà payés.
export type BillingPeriod = 'monthly' | 'semiannual' | 'annual' | 'quarterly'

export const BILLING_PERIODS: Record<BillingPeriod, { months: number; days: number; paidMonths: number; legacy?: boolean }> = {
  monthly:    { months: 1,  days: 31,  paidMonths: 1 },
  semiannual: { months: 6,  days: 183, paidMonths: 5.5 },
  annual:     { months: 12, days: 365, paidMonths: 10 },
  // Ancienne durée (−8 %), plus proposée : abonnements en cours et renouvellements automatiques seulement
  quarterly:  { months: 3,  days: 92,  paidMonths: 2.76, legacy: true },
}

/** Durées proposées à l'achat, dans l'ordre d'affichage */
export const OFFERED_PERIODS: BillingPeriod[] = ['monthly', 'semiannual', 'annual']

/** Prix d'une durée : prix mensuel × mois payés (2 décimales au plus ; les prix ronds restent ronds). RÈGLE UNIQUE :
 *  page Abonnement, page d'accueil et serveur (/api/billing/subscribe). */
export function getPeriodPrice(baseMonthlyPrice: number, period: BillingPeriod): number {
  const cfg = BILLING_PERIODS[period] ?? BILLING_PERIODS.monthly
  return Math.round(baseMonthlyPrice * cfg.paidMonths * 100) / 100
}

export function getPeriodDays(period: BillingPeriod): number {
  return BILLING_PERIODS[period].days
}

export type PaymentMethodType = 'cash' | 'mobile_money' | 'transfer' | 'card' | 'credit'

export interface PaymentMethod {
  id: string
  label: string
  icon: string
  logo?: string
  type: PaymentMethodType
}

export interface CountryConfig {
  code: CountryCode
  name: string
  flag: string
  flagColor: string
  /** Devise MÉTIER de la boutique (POS, stock, rapports, reçus) — ce que
   *  `shops.currency` doit valoir pour ce pays. */
  currency: string
  currencySymbol: string
  /**
   * Devise de FACTURATION de l'abonnement StockShop (ce qui est envoyé à la
   * passerelle de paiement / Stripe). Absente = identique à `currency`
   * (cas de tous les marchés africains : on facture dans la devise locale).
   * Les 27 pays de l'Union européenne sont le seul cas où elle diverge :
   * la boutique opère dans sa devise nationale (`currency`, ex. PLN, SEK,
   * CZK…) mais StockShop facture en EUR pour tous (§ V1 — pas de
   * tarification locale hors zone euro pour l'instant). Ne jamais lire
   * `currency` pour un montant facturé à la passerelle — utiliser
   * `getBillingCurrency(country)`.
   */
  billingCurrency?: string
  gateway: 'paystack' | 'flutterwave' | 'notchpay' | 'stripe'
  /** Prix MENSUELS des formules, dans la devise de facturation (tableau validé le 3 nov. 2026) */
  prices: {
    starter: number
    pro: number
    business: number
  }
  /** Options par mois : employé et boutique en plus (environ 15 % et 40 % du Pro, arrondis) */
  addons: { seat: number; shop: number }
  phonePrefix: string
  cityPlaceholder: string
  paymentMethods: PaymentMethod[]
}

/** Devise dans laquelle l'abonnement StockShop est réellement facturé —
 *  jamais `country.currency` directement pour un montant envoyé à une
 *  passerelle de paiement (voir `CountryConfig.billingCurrency`). */
export function getBillingCurrency(country: CountryConfig): string {
  return country.billingCurrency ?? country.currency
}

export function getMethodType(methodId: string, country: CountryConfig): PaymentMethodType {
  return country.paymentMethods.find(m => m.id === methodId)?.type ?? 'cash'
}

// Flattened id → label map built lazily from every country's paymentMethods.
// Brand names (Orange Money, Wave, MTN MoMo…) are the same across locales,
// so this is the single source of truth instead of duplicating them in
// messages/*.json for every language.
let _methodLabelMap: Map<string, string> | null = null
export function getPaymentMethodLabel(methodId: string): string | undefined {
  if (!_methodLabelMap) {
    _methodLabelMap = new Map()
    for (const country of Object.values(COUNTRIES)) {
      for (const m of country.paymentMethods) {
        if (!_methodLabelMap.has(m.id)) _methodLabelMap.set(m.id, m.label)
      }
    }
  }
  return _methodLabelMap.get(methodId)
}

// Méthodes de paiement génériques pour les 27 pays de l'Union européenne —
// mêmes rails partout (carte, virement, PayPal), pas de spécificité locale
// modélisée pour l'instant.
const EU_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'cash',     label: 'Espèces',        icon: '💵', type: 'cash' },
  { id: 'card',     label: 'Carte bancaire', icon: '💳', type: 'card' },
  { id: 'transfer', label: 'Virement',       icon: '🏦', type: 'transfer' },
  { id: 'paypal',   label: 'PayPal',         icon: '🔵', type: 'card' },
  { id: 'credit',   label: 'Crédit',         icon: '📝', type: 'credit' },
]

/**
 * Construit la config d'un pays de l'Union européenne. `currency` /
 * `currencySymbol` sont la devise MÉTIER réelle du pays (EUR pour 21
 * d'entre eux, devise nationale pour les 6 hors zone euro — ne jamais
 * supposer que « UE » = « zone euro »). `billingCurrency` est TOUJOURS
 * 'EUR' : StockShop facture l'abonnement en euros pour les 27, quelle que
 * soit la devise boutique (V1 — pas de tarification locale PLN/SEK/CZK/
 * DKK/HUF/RON tant qu'elle n'aura pas été fixée par l'équipe).
 */
function euCountry(
  code: CountryCode, name: string, flag: string, flagColor: string,
  currency: string, currencySymbol: string,
  phonePrefix: string, cityPlaceholder: string,
): CountryConfig {
  return {
    code, name, flag, flagColor,
    currency, currencySymbol,
    billingCurrency: 'EUR',
    gateway: 'stripe',
    prices: { starter: 15, pro: 25, business: 50 },
    addons: { seat: 5, shop: 12 },
    phonePrefix, cityPlaceholder,
    paymentMethods: EU_PAYMENT_METHODS,
  }
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {

  // ── Afrique de l'Ouest — zone FCFA (XOF / XAF) ──────────────────────────

  NG: {
    code: 'NG', name: 'Nigeria', flag: '🇳🇬', flagColor: '#008751',
    currency: 'NGN', currencySymbol: '₦', gateway: 'paystack',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+234', cityPlaceholder: 'Lagos, Kano, Abuja…',
    paymentMethods: [
      { id: 'cash',       label: 'Cash',         icon: '💵', type: 'cash' },
      { id: 'transfer',   label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'pos',        label: 'POS / Card',    icon: '💳', type: 'card' },
      { id: 'opay',       label: 'OPay',          icon: '📱', logo: '/payment/opay.png',       type: 'mobile_money' },
      { id: 'palmpay',    label: 'PalmPay',       icon: '📱', logo: '/payment/palmpay.png',    type: 'mobile_money' },
      { id: 'moniepoint', label: 'Moniepoint',    icon: '📱', logo: '/payment/moniepoint.png', type: 'mobile_money' },
      { id: 'credit',     label: 'Credit',        icon: '📝', type: 'credit' },
    ],
  },

  CM: {
    code: 'CM', name: 'Cameroun', flag: '🇨🇲', flagColor: '#CE1126',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'notchpay',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+237', cityPlaceholder: 'Douala, Yaoundé, Bafoussam…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'mtn_momo',     label: 'MTN MoMo',     icon: '📱', logo: '/payment/mtn_momo.png',     type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  CI: {
    code: 'CI', name: "Côte d'Ivoire", flag: '🇨🇮', flagColor: '#F77F00',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+225', cityPlaceholder: 'Abidjan, Bouaké, San-Pédro…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',         type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'mtn_momo',     label: 'MTN MoMo',     icon: '📱', logo: '/payment/mtn_momo.png',     type: 'mobile_money' },
      { id: 'moov_money',   label: 'Moov Money',   icon: '📱', logo: '/payment/moov_money.png',   type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  ML: {
    code: 'ML', name: 'Mali', flag: '🇲🇱', flagColor: '#FCD116',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+223', cityPlaceholder: 'Bamako, Sikasso, Ségou…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',          type: 'mobile_money' },
      { id: 'moov_money',   label: 'Moov Money',   icon: '📱', logo: '/payment/moov_money.png',    type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  NE: {
    code: 'NE', name: 'Niger', flag: '🇳🇪', flagColor: '#E05206',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+227', cityPlaceholder: 'Niamey, Zinder, Maradi…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'amana',        label: 'Amana',        icon: '📱', logo: '/payment/amana.png',        type: 'mobile_money' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',         type: 'mobile_money' },
      { id: 'nita',         label: 'NITA',         icon: '📱', logo: '/payment/nita.png',         type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', logo: '/payment/airtel_money.png', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  SN: {
    code: 'SN', name: 'Sénégal', flag: '🇸🇳', flagColor: '#00853F',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+221', cityPlaceholder: 'Dakar, Thiès, Saint-Louis…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',         type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'free_money',   label: 'Free Money',   icon: '📱', logo: '/payment/free_money.png',   type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  BJ: {
    code: 'BJ', name: 'Bénin', flag: '🇧🇯', flagColor: '#008751',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+229', cityPlaceholder: 'Cotonou, Porto-Novo, Parakou…',
    paymentMethods: [
      { id: 'cash',       label: 'Espèces',    icon: '💵', type: 'cash' },
      { id: 'mtn_momo',   label: 'MTN MoMo',   icon: '📱', logo: '/payment/mtn_momo.png',   type: 'mobile_money' },
      { id: 'moov_money', label: 'Moov Money', icon: '📱', logo: '/payment/moov_money.png', type: 'mobile_money' },
      { id: 'wave',       label: 'Wave',       icon: '🌊', logo: '/payment/wave.png',       type: 'mobile_money' },
      { id: 'transfer',   label: 'Virement',   icon: '🏦', type: 'transfer' },
      { id: 'credit',     label: 'Crédit',     icon: '📝', type: 'credit' },
    ],
  },

  TG: {
    code: 'TG', name: 'Togo', flag: '🇹🇬', flagColor: '#D21034',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+228', cityPlaceholder: 'Lomé, Sokodé, Kara…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces',  icon: '💵', type: 'cash' },
      { id: 'flooz',    label: 'Flooz',    icon: '📱', type: 'mobile_money' },
      { id: 'tmoney',   label: 'T-Money',  icon: '📱', logo: '/payment/tmoney.jpg', type: 'mobile_money' },
      { id: 'transfer', label: 'Virement', icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Crédit',   icon: '📝', type: 'credit' },
    ],
  },

  BF: {
    code: 'BF', name: 'Burkina Faso', flag: '🇧🇫', flagColor: '#EF2B2D',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+226', cityPlaceholder: 'Ouagadougou, Bobo-Dioulasso, Koudougou…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'moov_money',   label: 'Moov Money',   icon: '📱', logo: '/payment/moov_money.png',   type: 'mobile_money' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',         type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  // ── Afrique de l'Ouest — autres devises ─────────────────────────────────

  GH: {
    code: 'GH', name: 'Ghana', flag: '🇬🇭', flagColor: '#006B3F',
    currency: 'GHS', currencySymbol: 'GH₵', gateway: 'flutterwave',
    prices: { starter: 100, pro: 200, business: 300 },
    addons: { seat: 30, shop: 80 },
    phonePrefix: '+233', cityPlaceholder: 'Accra, Kumasi, Tamale…',
    paymentMethods: [
      { id: 'cash',        label: 'Cash',         icon: '💵', type: 'cash' },
      { id: 'mtn_momo',    label: 'MTN MoMo',     icon: '📱', logo: '/payment/mtn_momo.png', type: 'mobile_money' },
      { id: 'airtel_tigo', label: 'AirtelTigo',   icon: '📱', type: 'mobile_money' },
      { id: 'pos',         label: 'Visa / Mastercard', icon: '💳', type: 'card' },
      { id: 'transfer',    label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit',      label: 'Credit',        icon: '📝', type: 'credit' },
    ],
  },

  GN: {
    code: 'GN', name: 'Guinée', flag: '🇬🇳', flagColor: '#CE1126',
    currency: 'GNF', currencySymbol: 'FG', gateway: 'flutterwave',
    prices: { starter: 50000, pro: 100000, business: 150000 },
    addons: { seat: 15000, shop: 40000 },
    phonePrefix: '+224', cityPlaceholder: 'Conakry, Kankan, Labé…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'mtn_momo',     label: 'MTN MoMo',     icon: '📱', logo: '/payment/mtn_momo.png',     type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  GW: {
    code: 'GW', name: 'Guinée-Bissau', flag: '🇬🇼', flagColor: '#009E49',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+245', cityPlaceholder: 'Bissau, Bafatá, Gabú…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  GM: {
    code: 'GM', name: 'Gambie', flag: '🇬🇲', flagColor: '#3A7728',
    currency: 'GMD', currencySymbol: 'D', gateway: 'flutterwave',
    prices: { starter: 500, pro: 1000, business: 1500 },
    addons: { seat: 150, shop: 400 },
    phonePrefix: '+220', cityPlaceholder: 'Banjul, Serrekunda, Brikama…',
    paymentMethods: [
      { id: 'cash',     label: 'Cash',         icon: '💵', type: 'cash' },
      { id: 'wave',     label: 'Wave',         icon: '🌊', logo: '/payment/wave.png', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Credit',        icon: '📝', type: 'credit' },
    ],
  },

  SL: {
    code: 'SL', name: 'Sierra Leone', flag: '🇸🇱', flagColor: '#1EB53A',
    currency: 'SLE', currencySymbol: 'Le', gateway: 'flutterwave',
    prices: { starter: 150, pro: 300, business: 450 },
    addons: { seat: 45, shop: 120 },
    phonePrefix: '+232', cityPlaceholder: 'Freetown, Bo, Kenema…',
    paymentMethods: [
      { id: 'cash',         label: 'Cash',         icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'transfer',     label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Credit',        icon: '📝', type: 'credit' },
    ],
  },

  LR: {
    code: 'LR', name: 'Libéria', flag: '🇱🇷', flagColor: '#BF0A30',
    currency: 'LRD', currencySymbol: 'L$', gateway: 'flutterwave',
    // Facturé en dollars : les commerçants y comptent en dollars (tableau du 3 nov. 2026)
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+231', cityPlaceholder: 'Monrovia, Gbarnga, Kakata…',
    paymentMethods: [
      { id: 'cash',         label: 'Cash',         icon: '💵', type: 'cash' },
      { id: 'mtn_momo',     label: 'MTN Mobile Money', icon: '📱', logo: '/payment/mtn_momo.png', type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'transfer',     label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Credit',        icon: '📝', type: 'credit' },
    ],
  },

  CV: {
    code: 'CV', name: 'Cap-Vert', flag: '🇨🇻', flagColor: '#003893',
    currency: 'CVE', currencySymbol: 'Esc', gateway: 'stripe',
    prices: { starter: 1000, pro: 2000, business: 3000 },
    addons: { seat: 300, shop: 800 },
    phonePrefix: '+238', cityPlaceholder: 'Praia, Mindelo, Santa Maria…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces',        icon: '💵', type: 'cash' },
      { id: 'card',     label: 'Carte bancaire', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Virement',       icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Crédit',         icon: '📝', type: 'credit' },
    ],
  },

  MR: {
    code: 'MR', name: 'Mauritanie', flag: '🇲🇷', flagColor: '#006233',
    currency: 'MRU', currencySymbol: 'UM', gateway: 'flutterwave',
    prices: { starter: 300, pro: 600, business: 900 },
    addons: { seat: 90, shop: 240 },
    phonePrefix: '+222', cityPlaceholder: 'Nouakchott, Nouadhibou, Rosso…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces', icon: '💵', type: 'cash' },
      { id: 'transfer', label: 'Virement', icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Crédit',   icon: '📝', type: 'credit' },
    ],
  },

  // ── Afrique Centrale ─────────────────────────────────────────────────────

  CD: {
    code: 'CD', name: 'Congo RDC', flag: '🇨🇩', flagColor: '#007FFF',
    currency: 'CDF', currencySymbol: 'FC', gateway: 'flutterwave',
    // Facturé en dollars : les commerçants y comptent en dollars (tableau du 3 nov. 2026)
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+243', cityPlaceholder: 'Kinshasa, Lubumbashi, Goma…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'mtn_momo',     label: 'M-Pesa',       icon: '📱', logo: '/payment/mtn_momo.png',     type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  CG: {
    code: 'CG', name: 'Congo-Brazzaville', flag: '🇨🇬', flagColor: '#009543',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+242', cityPlaceholder: 'Brazzaville, Pointe-Noire, Dolisie…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'mtn_momo',     label: 'MTN MoMo',     icon: '📱', logo: '/payment/mtn_momo.png', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  GA: {
    code: 'GA', name: 'Gabon', flag: '🇬🇦', flagColor: '#009E60',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+241', cityPlaceholder: 'Libreville, Port-Gentil, Franceville…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'moov_money',   label: 'Moov Money',   icon: '📱', logo: '/payment/moov_money.png', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  GQ: {
    code: 'GQ', name: 'Guinée Équatoriale', flag: '🇬🇶', flagColor: '#3E9A00',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+240', cityPlaceholder: 'Malabo, Bata, Mongomo…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces',  icon: '💵', type: 'cash' },
      { id: 'mtn_momo', label: 'MTN MoMo', icon: '📱', logo: '/payment/mtn_momo.png', type: 'mobile_money' },
      { id: 'transfer', label: 'Virement', icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Crédit',   icon: '📝', type: 'credit' },
    ],
  },

  CF: {
    code: 'CF', name: 'Centrafrique', flag: '🇨🇫', flagColor: '#003082',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+236', cityPlaceholder: 'Bangui, Bimbo, Berbérati…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  TD: {
    code: 'TD', name: 'Tchad', flag: '🇹🇩', flagColor: '#002664',
    currency: 'XAF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 10000, business: 15000 },
    addons: { seat: 1500, shop: 4000 },
    phonePrefix: '+235', cityPlaceholder: "N'Djamena, Moundou, Sarh…",
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },

  // ── Union européenne — 27 pays individuels ──────────────────────────────
  // UE ≠ zone euro : 21 pays en EUR, 6 dans leur devise nationale. La devise
  // de facturation StockShop (billingCurrency) est EUR pour les 27 — voir
  // euCountry(). Jamais de section "Europe" groupée : chaque pays a son
  // propre code ISO 3166-1 alpha-2, mélangé avec les autres dans COUNTRIES.

  DE: euCountry('DE', 'Allemagne',          '🇩🇪', '#000000', 'EUR', '€',   '+49',  'Berlin, Munich, Hambourg…'),
  AT: euCountry('AT', 'Autriche',           '🇦🇹', '#ED2939', 'EUR', '€',   '+43',  'Vienne, Graz, Linz…'),
  BE: euCountry('BE', 'Belgique',           '🇧🇪', '#FDDA24', 'EUR', '€',   '+32',  'Bruxelles, Anvers, Gand…'),
  BG: euCountry('BG', 'Bulgarie',           '🇧🇬', '#00966E', 'EUR', '€',   '+359', 'Sofia, Plovdiv, Varna…'),
  HR: euCountry('HR', 'Croatie',            '🇭🇷', '#171796', 'EUR', '€',   '+385', 'Zagreb, Split, Rijeka…'),
  CY: euCountry('CY', 'Chypre',             '🇨🇾', '#D57800', 'EUR', '€',   '+357', 'Nicosie, Limassol, Larnaca…'),
  DK: euCountry('DK', 'Danemark',           '🇩🇰', '#C60C30', 'DKK', 'kr',  '+45',  'Copenhague, Aarhus, Odense…'),
  ES: euCountry('ES', 'Espagne',            '🇪🇸', '#AA151B', 'EUR', '€',   '+34',  'Madrid, Barcelone, Valence…'),
  EE: euCountry('EE', 'Estonie',            '🇪🇪', '#0072CE', 'EUR', '€',   '+372', 'Tallinn, Tartu, Narva…'),
  FI: euCountry('FI', 'Finlande',           '🇫🇮', '#002F6C', 'EUR', '€',   '+358', 'Helsinki, Espoo, Tampere…'),
  FR: euCountry('FR', 'France',             '🇫🇷', '#0055A4', 'EUR', '€',   '+33',  'Paris, Lyon, Marseille…'),
  GR: euCountry('GR', 'Grèce',              '🇬🇷', '#0D5EAF', 'EUR', '€',   '+30',  'Athènes, Thessalonique, Patras…'),
  HU: euCountry('HU', 'Hongrie',            '🇭🇺', '#436F4D', 'HUF', 'Ft',  '+36',  'Budapest, Debrecen, Szeged…'),
  IE: euCountry('IE', 'Irlande',            '🇮🇪', '#169B62', 'EUR', '€',   '+353', 'Dublin, Cork, Galway…'),
  IT: euCountry('IT', 'Italie',             '🇮🇹', '#009246', 'EUR', '€',   '+39',  'Rome, Milan, Naples…'),
  LV: euCountry('LV', 'Lettonie',           '🇱🇻', '#9E3039', 'EUR', '€',   '+371', 'Riga, Daugavpils, Liepāja…'),
  LT: euCountry('LT', 'Lituanie',           '🇱🇹', '#FDB913', 'EUR', '€',   '+370', 'Vilnius, Kaunas, Klaipėda…'),
  LU: euCountry('LU', 'Luxembourg',         '🇱🇺', '#00A1DE', 'EUR', '€',   '+352', 'Luxembourg, Esch-sur-Alzette…'),
  MT: euCountry('MT', 'Malte',              '🇲🇹', '#CF142B', 'EUR', '€',   '+356', 'La Valette, Birkirkara…'),
  NL: euCountry('NL', 'Pays-Bas',           '🇳🇱', '#21468B', 'EUR', '€',   '+31',  'Amsterdam, Rotterdam, La Haye…'),
  PL: euCountry('PL', 'Pologne',            '🇵🇱', '#DC143C', 'PLN', 'zł',  '+48',  'Varsovie, Cracovie, Wrocław…'),
  PT: euCountry('PT', 'Portugal',           '🇵🇹', '#FF0000', 'EUR', '€',   '+351', 'Lisbonne, Porto, Braga…'),
  CZ: euCountry('CZ', 'République tchèque', '🇨🇿', '#11457E', 'CZK', 'Kč',  '+420', 'Prague, Brno, Ostrava…'),
  RO: euCountry('RO', 'Roumanie',           '🇷🇴', '#002B7F', 'RON', 'lei', '+40',  'Bucarest, Cluj-Napoca, Timișoara…'),
  SK: euCountry('SK', 'Slovaquie',          '🇸🇰', '#0B4EA2', 'EUR', '€',   '+421', 'Bratislava, Košice, Žilina…'),
  SI: euCountry('SI', 'Slovénie',           '🇸🇮', '#005DA4', 'EUR', '€',   '+386', 'Ljubljana, Maribor, Celje…'),
  SE: euCountry('SE', 'Suède',              '🇸🇪', '#006AA7', 'SEK', 'kr',  '+46',  'Stockholm, Göteborg, Malmö…'),

  // ── International (hors UE) ─────────────────────────────────────────────

  US: {
    code: 'US', name: 'United States', flag: '🇺🇸', flagColor: '#B22234',
    currency: 'USD', currencySymbol: '$', gateway: 'stripe',
    prices: { starter: 15, pro: 25, business: 50 },
    addons: { seat: 5, shop: 12 },
    phonePrefix: '+1', cityPlaceholder: 'New York, Los Angeles, Chicago…',
    paymentMethods: [
      { id: 'cash',     label: 'Cash',           icon: '💵', type: 'cash' },
      { id: 'card',     label: 'Credit / Debit', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer',  icon: '🏦', type: 'transfer' },
      { id: 'paypal',   label: 'PayPal',         icon: '🔵', type: 'card' },
      { id: 'zelle',    label: 'Zelle',          icon: '📱', type: 'mobile_money' },
      { id: 'venmo',    label: 'Venmo',          icon: '📱', type: 'mobile_money' },
      { id: 'credit',   label: 'Credit',         icon: '📝', type: 'credit' },
    ],
  },

  CA: {
    code: 'CA', name: 'Canada', flag: '🇨🇦', flagColor: '#FF0000',
    currency: 'CAD', currencySymbol: 'CA$', gateway: 'stripe',
    prices: { starter: 20, pro: 35, business: 70 },
    addons: { seat: 7, shop: 17 },
    phonePrefix: '+1', cityPlaceholder: 'Toronto, Montréal, Vancouver…',
    paymentMethods: [
      { id: 'cash',      label: 'Cash',           icon: '💵', type: 'cash' },
      { id: 'card',      label: 'Credit / Debit', icon: '💳', type: 'card' },
      { id: 'etransfer', label: 'e-Transfer',     icon: '🏦', type: 'transfer' },
      { id: 'paypal',    label: 'PayPal',         icon: '🔵', type: 'card' },
      { id: 'credit',    label: 'Credit',         icon: '📝', type: 'credit' },
    ],
  },

  // ── Nouveaux pays (tarification du 3 nov. 2026, tableau validé) ─────────
  // Paiement de l'abonnement par Flutterwave ; « billingCurrency: 'USD' » : pays où les commerçants comptent en dollars
  // (la boutique garde sa monnaie locale pour la caisse, le stock et les rapports).

  KE: {
    code: 'KE', name: 'Kenya', flag: '🇰🇪', flagColor: '#006600',
    currency: 'KES', currencySymbol: 'KSh', gateway: 'flutterwave',
    prices: { starter: 1000, pro: 2000, business: 3000 },
    addons: { seat: 300, shop: 800 },
    phonePrefix: '+254', cityPlaceholder: 'Nairobi, Mombasa, Kisumu…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mpesa', label: 'M-Pesa', icon: '📱', type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  UG: {
    code: 'UG', name: 'Ouganda', flag: '🇺🇬', flagColor: '#FCDC04',
    currency: 'UGX', currencySymbol: 'USh', gateway: 'flutterwave',
    prices: { starter: 30000, pro: 60000, business: 90000 },
    addons: { seat: 9000, shop: 24000 },
    phonePrefix: '+256', cityPlaceholder: 'Kampala, Gulu, Mbarara…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mtn_momo', label: 'MTN MoMo', icon: '📱', type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  TZ: {
    code: 'TZ', name: 'Tanzanie', flag: '🇹🇿', flagColor: '#1EB53A',
    currency: 'TZS', currencySymbol: 'TSh', gateway: 'flutterwave',
    prices: { starter: 20000, pro: 40000, business: 60000 },
    addons: { seat: 6000, shop: 16000 },
    phonePrefix: '+255', cityPlaceholder: 'Dar es Salaam, Arusha, Mwanza…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mpesa', label: 'M-Pesa', icon: '📱', type: 'mobile_money' },
      { id: 'mixx', label: 'Mixx by Yas', icon: '📱', type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  RW: {
    code: 'RW', name: 'Rwanda', flag: '🇷🇼', flagColor: '#00A1DE',
    currency: 'RWF', currencySymbol: 'FRw', gateway: 'flutterwave',
    prices: { starter: 10000, pro: 20000, business: 30000 },
    addons: { seat: 3000, shop: 8000 },
    phonePrefix: '+250', cityPlaceholder: 'Kigali, Huye, Musanze…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mtn_momo', label: 'MTN MoMo', icon: '📱', type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  ET: {
    code: 'ET', name: 'Éthiopie', flag: '🇪🇹', flagColor: '#078930',
    currency: 'ETB', currencySymbol: 'Br', gateway: 'flutterwave',
    prices: { starter: 1000, pro: 2000, business: 3000 },
    addons: { seat: 300, shop: 800 },
    phonePrefix: '+251', cityPlaceholder: 'Addis-Abeba, Dire Dawa, Mekele…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'telebirr', label: 'telebirr', icon: '📱', type: 'mobile_money' },
      { id: 'cbe_birr', label: 'CBE Birr', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  MA: {
    code: 'MA', name: 'Maroc', flag: '🇲🇦', flagColor: '#C1272D',
    currency: 'MAD', currencySymbol: 'DH', gateway: 'flutterwave',
    prices: { starter: 75, pro: 150, business: 225 },
    addons: { seat: 25, shop: 60 },
    phonePrefix: '+212', cityPlaceholder: 'Casablanca, Rabat, Marrakech…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  TN: {
    code: 'TN', name: 'Tunisie', flag: '🇹🇳', flagColor: '#E70013',
    currency: 'TND', currencySymbol: 'DT', gateway: 'flutterwave',
    prices: { starter: 25, pro: 50, business: 75 },
    addons: { seat: 8, shop: 20 },
    phonePrefix: '+216', cityPlaceholder: 'Tunis, Sfax, Sousse…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'd17', label: 'D17', icon: '📱', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  DZ: {
    code: 'DZ', name: 'Algérie', flag: '🇩🇿', flagColor: '#006233',
    currency: 'DZD', currencySymbol: 'DA', gateway: 'flutterwave',
    prices: { starter: 1000, pro: 2000, business: 3000 },
    addons: { seat: 300, shop: 800 },
    phonePrefix: '+213', cityPlaceholder: 'Alger, Oran, Constantine…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'baridimob', label: 'BaridiMob', icon: '📱', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  EG: {
    code: 'EG', name: 'Égypte', flag: '🇪🇬', flagColor: '#CE1126',
    currency: 'EGP', currencySymbol: 'E£', gateway: 'flutterwave',
    prices: { starter: 400, pro: 800, business: 1200 },
    addons: { seat: 120, shop: 320 },
    phonePrefix: '+20', cityPlaceholder: 'Le Caire, Alexandrie, Gizeh…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'vodafone_cash', label: 'Vodafone Cash', icon: '📱', type: 'mobile_money' },
      { id: 'instapay', label: 'InstaPay', icon: '📱', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  ZA: {
    code: 'ZA', name: 'Afrique du Sud', flag: '🇿🇦', flagColor: '#007A4D',
    currency: 'ZAR', currencySymbol: 'R', gateway: 'flutterwave',
    prices: { starter: 150, pro: 300, business: 450 },
    addons: { seat: 45, shop: 120 },
    phonePrefix: '+27', cityPlaceholder: 'Johannesburg, Le Cap, Durban…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'snapscan', label: 'SnapScan', icon: '📱', type: 'mobile_money' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  IN: {
    code: 'IN', name: 'Inde', flag: '🇮🇳', flagColor: '#FF9933',
    currency: 'INR', currencySymbol: '₹', gateway: 'flutterwave',
    prices: { starter: 499, pro: 999, business: 1499 },
    addons: { seat: 149, shop: 399 },
    phonePrefix: '+91', cityPlaceholder: 'Mumbai, Delhi, Bangalore…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'upi', label: 'UPI', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  PK: {
    code: 'PK', name: 'Pakistan', flag: '🇵🇰', flagColor: '#01411C',
    currency: 'PKR', currencySymbol: 'Rs', gateway: 'flutterwave',
    prices: { starter: 1500, pro: 3000, business: 4500 },
    addons: { seat: 450, shop: 1200 },
    phonePrefix: '+92', cityPlaceholder: 'Karachi, Lahore, Islamabad…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'jazzcash', label: 'JazzCash', icon: '📱', type: 'mobile_money' },
      { id: 'easypaisa', label: 'Easypaisa', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  BD: {
    code: 'BD', name: 'Bangladesh', flag: '🇧🇩', flagColor: '#006A4E',
    currency: 'BDT', currencySymbol: '৳', gateway: 'flutterwave',
    prices: { starter: 500, pro: 1000, business: 1500 },
    addons: { seat: 150, shop: 400 },
    phonePrefix: '+880', cityPlaceholder: 'Dacca, Chittagong, Khulna…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'bkash', label: 'bKash', icon: '📱', type: 'mobile_money' },
      { id: 'nagad', label: 'Nagad', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  PH: {
    code: 'PH', name: 'Philippines', flag: '🇵🇭', flagColor: '#0038A8',
    currency: 'PHP', currencySymbol: '₱', gateway: 'flutterwave',
    prices: { starter: 300, pro: 600, business: 900 },
    addons: { seat: 90, shop: 240 },
    phonePrefix: '+63', cityPlaceholder: 'Manille, Cebu, Davao…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'gcash', label: 'GCash', icon: '📱', type: 'mobile_money' },
      { id: 'maya', label: 'Maya', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  ID: {
    code: 'ID', name: 'Indonésie', flag: '🇮🇩', flagColor: '#CE1126',
    currency: 'IDR', currencySymbol: 'Rp', gateway: 'flutterwave',
    prices: { starter: 100000, pro: 200000, business: 300000 },
    addons: { seat: 30000, shop: 80000 },
    phonePrefix: '+62', cityPlaceholder: 'Jakarta, Surabaya, Bandung…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'qris', label: 'QRIS', icon: '📱', type: 'mobile_money' },
      { id: 'gopay', label: 'GoPay', icon: '📱', type: 'mobile_money' },
      { id: 'ovo', label: 'OVO', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  VN: {
    code: 'VN', name: 'Viêt Nam', flag: '🇻🇳', flagColor: '#DA251D',
    currency: 'VND', currencySymbol: '₫', gateway: 'flutterwave',
    prices: { starter: 150000, pro: 300000, business: 450000 },
    addons: { seat: 45000, shop: 120000 },
    phonePrefix: '+84', cityPlaceholder: 'Hô Chi Minh-Ville, Hanoï, Da Nang…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'momo', label: 'MoMo', icon: '📱', type: 'mobile_money' },
      { id: 'vietqr', label: 'VietQR', icon: '🏦', type: 'transfer' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  NP: {
    code: 'NP', name: 'Népal', flag: '🇳🇵', flagColor: '#DC143C',
    currency: 'NPR', currencySymbol: 'Rs', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+977', cityPlaceholder: 'Katmandou, Pokhara, Lalitpur…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'esewa', label: 'eSewa', icon: '📱', type: 'mobile_money' },
      { id: 'khalti', label: 'Khalti', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  LK: {
    code: 'LK', name: 'Sri Lanka', flag: '🇱🇰', flagColor: '#8D153A',
    currency: 'LKR', currencySymbol: 'Rs', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+94', cityPlaceholder: 'Colombo, Kandy, Galle…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  KH: {
    code: 'KH', name: 'Cambodge', flag: '🇰🇭', flagColor: '#032EA1',
    currency: 'KHR', currencySymbol: '៛', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+855', cityPlaceholder: 'Phnom Penh, Siem Reap, Battambang…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'aba', label: 'ABA', icon: '🏦', type: 'transfer' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  MM: {
    code: 'MM', name: 'Birmanie', flag: '🇲🇲', flagColor: '#FECB00',
    currency: 'MMK', currencySymbol: 'K', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+95', cityPlaceholder: 'Rangoun, Mandalay, Naypyidaw…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'kbzpay', label: 'KBZPay', icon: '📱', type: 'mobile_money' },
      { id: 'wave_money', label: 'Wave Money', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  CN: {
    code: 'CN', name: 'Chine', flag: '🇨🇳', flagColor: '#DE2910',
    currency: 'CNY', currencySymbol: '¥', gateway: 'flutterwave',
    prices: { starter: 70, pro: 140, business: 250 },
    addons: { seat: 20, shop: 55 },
    phonePrefix: '+86', cityPlaceholder: 'Shanghai, Pékin, Canton…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'alipay', label: 'Alipay', icon: '📱', type: 'mobile_money' },
      { id: 'wechat_pay', label: 'WeChat Pay', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  MY: {
    code: 'MY', name: 'Malaisie', flag: '🇲🇾', flagColor: '#010066',
    currency: 'MYR', currencySymbol: 'RM', gateway: 'flutterwave',
    prices: { starter: 45, pro: 90, business: 160 },
    addons: { seat: 15, shop: 35 },
    phonePrefix: '+60', cityPlaceholder: 'Kuala Lumpur, George Town, Johor Bahru…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'duitnow', label: 'DuitNow QR', icon: '📱', type: 'mobile_money' },
      { id: 'tng', label: 'Touch \'n Go', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  TH: {
    code: 'TH', name: 'Thaïlande', flag: '🇹🇭', flagColor: '#2D2A4A',
    currency: 'THB', currencySymbol: '฿', gateway: 'flutterwave',
    prices: { starter: 350, pro: 700, business: 1200 },
    addons: { seat: 100, shop: 280 },
    phonePrefix: '+66', cityPlaceholder: 'Bangkok, Chiang Mai, Phuket…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'promptpay', label: 'PromptPay', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  JP: {
    code: 'JP', name: 'Japon', flag: '🇯🇵', flagColor: '#BC002D',
    currency: 'JPY', currencySymbol: '¥', gateway: 'flutterwave',
    prices: { starter: 2500, pro: 4000, business: 8000 },
    addons: { seat: 800, shop: 2000 },
    phonePrefix: '+81', cityPlaceholder: 'Tokyo, Osaka, Nagoya…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'paypay', label: 'PayPay', icon: '📱', type: 'mobile_money' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  KR: {
    code: 'KR', name: 'Corée du Sud', flag: '🇰🇷', flagColor: '#003478',
    currency: 'KRW', currencySymbol: '₩', gateway: 'flutterwave',
    prices: { starter: 20000, pro: 35000, business: 70000 },
    addons: { seat: 7000, shop: 17000 },
    phonePrefix: '+82', cityPlaceholder: 'Séoul, Busan, Incheon…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'kakaopay', label: 'KakaoPay', icon: '📱', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  SG: {
    code: 'SG', name: 'Singapour', flag: '🇸🇬', flagColor: '#EF3340',
    currency: 'SGD', currencySymbol: 'S$', gateway: 'flutterwave',
    prices: { starter: 20, pro: 35, business: 70 },
    addons: { seat: 7, shop: 17 },
    phonePrefix: '+65', cityPlaceholder: 'Singapour',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'paynow', label: 'PayNow', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  AE: {
    code: 'AE', name: 'Émirats arabes unis', flag: '🇦🇪', flagColor: '#00732F',
    currency: 'AED', currencySymbol: 'AED', gateway: 'flutterwave',
    prices: { starter: 50, pro: 90, business: 180 },
    addons: { seat: 18, shop: 45 },
    phonePrefix: '+971', cityPlaceholder: 'Dubaï, Abou Dabi, Charjah…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  SA: {
    code: 'SA', name: 'Arabie saoudite', flag: '🇸🇦', flagColor: '#006C35',
    currency: 'SAR', currencySymbol: 'SAR', gateway: 'flutterwave',
    prices: { starter: 50, pro: 90, business: 180 },
    addons: { seat: 18, shop: 45 },
    phonePrefix: '+966', cityPlaceholder: 'Riyad, Djeddah, La Mecque…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mada', label: 'mada', icon: '💳', type: 'card' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'stc_pay', label: 'STC Pay', icon: '📱', type: 'mobile_money' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  BR: {
    code: 'BR', name: 'Brésil', flag: '🇧🇷', flagColor: '#009C3B',
    currency: 'BRL', currencySymbol: 'R$', gateway: 'flutterwave',
    prices: { starter: 50, pro: 100, business: 175 },
    addons: { seat: 15, shop: 40 },
    phonePrefix: '+55', cityPlaceholder: 'São Paulo, Rio de Janeiro, Salvador…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'pix', label: 'Pix', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  MX: {
    code: 'MX', name: 'Mexique', flag: '🇲🇽', flagColor: '#006847',
    currency: 'MXN', currencySymbol: 'MX$', gateway: 'flutterwave',
    prices: { starter: 200, pro: 400, business: 700 },
    addons: { seat: 60, shop: 150 },
    phonePrefix: '+52', cityPlaceholder: 'Mexico, Guadalajara, Monterrey…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'spei', label: 'SPEI', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  CL: {
    code: 'CL', name: 'Chili', flag: '🇨🇱', flagColor: '#0039A6',
    currency: 'CLP', currencySymbol: 'CLP', gateway: 'flutterwave',
    prices: { starter: 10000, pro: 20000, business: 35000 },
    addons: { seat: 3000, shop: 7500 },
    phonePrefix: '+56', cityPlaceholder: 'Santiago, Valparaíso, Concepción…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  CO: {
    code: 'CO', name: 'Colombie', flag: '🇨🇴', flagColor: '#FCD116',
    currency: 'COP', currencySymbol: 'COP', gateway: 'flutterwave',
    prices: { starter: 40000, pro: 80000, business: 140000 },
    addons: { seat: 12000, shop: 30000 },
    phonePrefix: '+57', cityPlaceholder: 'Bogota, Medellín, Cali…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'nequi', label: 'Nequi', icon: '📱', type: 'mobile_money' },
      { id: 'daviplata', label: 'Daviplata', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  PE: {
    code: 'PE', name: 'Pérou', flag: '🇵🇪', flagColor: '#D91023',
    currency: 'PEN', currencySymbol: 'S/', gateway: 'flutterwave',
    prices: { starter: 35, pro: 70, business: 125 },
    addons: { seat: 10, shop: 30 },
    phonePrefix: '+51', cityPlaceholder: 'Lima, Arequipa, Trujillo…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'yape', label: 'Yape', icon: '📱', type: 'mobile_money' },
      { id: 'plin', label: 'Plin', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  AR: {
    code: 'AR', name: 'Argentine', flag: '🇦🇷', flagColor: '#74ACDF',
    currency: 'ARS', currencySymbol: 'AR$', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 10, pro: 20, business: 35 },
    addons: { seat: 3, shop: 8 },
    phonePrefix: '+54', cityPlaceholder: 'Buenos Aires, Córdoba, Rosario…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'mercado_pago', label: 'Mercado Pago', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  UY: {
    code: 'UY', name: 'Uruguay', flag: '🇺🇾', flagColor: '#0038A8',
    currency: 'UYU', currencySymbol: 'UY$', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 10, pro: 20, business: 35 },
    addons: { seat: 3, shop: 8 },
    phonePrefix: '+598', cityPlaceholder: 'Montevideo, Salto, Paysandú…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  EC: {
    code: 'EC', name: 'Équateur', flag: '🇪🇨', flagColor: '#FFD100',
    currency: 'USD', currencySymbol: '$', gateway: 'flutterwave',
    prices: { starter: 10, pro: 20, business: 35 },
    addons: { seat: 3, shop: 8 },
    phonePrefix: '+593', cityPlaceholder: 'Guayaquil, Quito, Cuenca…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  PA: {
    code: 'PA', name: 'Panama', flag: '🇵🇦', flagColor: '#005293',
    currency: 'USD', currencySymbol: '$', gateway: 'flutterwave',
    prices: { starter: 10, pro: 20, business: 35 },
    addons: { seat: 3, shop: 8 },
    phonePrefix: '+507', cityPlaceholder: 'Panama, Colón, David…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'yappy', label: 'Yappy', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  CR: {
    code: 'CR', name: 'Costa Rica', flag: '🇨🇷', flagColor: '#002B7F',
    currency: 'CRC', currencySymbol: '₡', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 10, pro: 20, business: 35 },
    addons: { seat: 3, shop: 8 },
    phonePrefix: '+506', cityPlaceholder: 'San José, Alajuela, Cartago…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'sinpe', label: 'SINPE Móvil', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  BO: {
    code: 'BO', name: 'Bolivie', flag: '🇧🇴', flagColor: '#007934',
    currency: 'BOB', currencySymbol: 'Bs', gateway: 'flutterwave',
    prices: { starter: 50, pro: 100, business: 150 },
    addons: { seat: 15, shop: 40 },
    phonePrefix: '+591', cityPlaceholder: 'Santa Cruz, La Paz, Cochabamba…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'qr_simple', label: 'QR Simple', icon: '🏦', type: 'transfer' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  GT: {
    code: 'GT', name: 'Guatemala', flag: '🇬🇹', flagColor: '#4997D0',
    currency: 'GTQ', currencySymbol: 'Q', gateway: 'flutterwave',
    prices: { starter: 50, pro: 100, business: 150 },
    addons: { seat: 15, shop: 40 },
    phonePrefix: '+502', cityPlaceholder: 'Guatemala, Mixco, Quetzaltenango…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  HN: {
    code: 'HN', name: 'Honduras', flag: '🇭🇳', flagColor: '#0073CF',
    currency: 'HNL', currencySymbol: 'L', gateway: 'flutterwave',
    prices: { starter: 200, pro: 400, business: 600 },
    addons: { seat: 60, shop: 160 },
    phonePrefix: '+504', cityPlaceholder: 'Tegucigalpa, San Pedro Sula, La Ceiba…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  HT: {
    code: 'HT', name: 'Haïti', flag: '🇭🇹', flagColor: '#00209F',
    currency: 'HTG', currencySymbol: 'G', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+509', cityPlaceholder: 'Port-au-Prince, Cap-Haïtien, Les Cayes…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'moncash', label: 'MonCash', icon: '📱', type: 'mobile_money' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  SV: {
    code: 'SV', name: 'Salvador', flag: '🇸🇻', flagColor: '#0F47AF',
    currency: 'USD', currencySymbol: '$', gateway: 'flutterwave',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+503', cityPlaceholder: 'San Salvador, Santa Ana, San Miguel…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  VE: {
    code: 'VE', name: 'Venezuela', flag: '🇻🇪', flagColor: '#FFCC00',
    currency: 'VES', currencySymbol: 'Bs.', gateway: 'flutterwave',
    billingCurrency: 'USD',
    prices: { starter: 5, pro: 10, business: 15 },
    addons: { seat: 1.5, shop: 4 },
    phonePrefix: '+58', cityPlaceholder: 'Caracas, Maracaibo, Valencia…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'pago_movil', label: 'Pago Móvil', icon: '🏦', type: 'transfer' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  GB: {
    code: 'GB', name: 'Royaume-Uni', flag: '🇬🇧', flagColor: '#012169',
    currency: 'GBP', currencySymbol: '£', gateway: 'flutterwave',
    prices: { starter: 12, pro: 20, business: 40 },
    addons: { seat: 4, shop: 10 },
    phonePrefix: '+44', cityPlaceholder: 'Londres, Manchester, Birmingham…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },

  CH: {
    code: 'CH', name: 'Suisse', flag: '🇨🇭', flagColor: '#DA291C',
    currency: 'CHF', currencySymbol: 'CHF', gateway: 'flutterwave',
    prices: { starter: 15, pro: 25, business: 50 },
    addons: { seat: 5, shop: 12 },
    phonePrefix: '+41', cityPlaceholder: 'Zurich, Genève, Bâle…',
    paymentMethods: [
      { id: 'cash', label: 'Cash', icon: '💵', type: 'cash' },
      { id: 'card', label: 'Card', icon: '💳', type: 'card' },
      { id: 'twint', label: 'TWINT', icon: '📱', type: 'mobile_money' },
      { id: 'transfer', label: 'Bank Transfer', icon: '🏦', type: 'transfer' },
      { id: 'credit', label: 'Credit', icon: '📝', type: 'credit' },
    ],
  },
}

export function getCountry(code: string | null | undefined): CountryConfig {
  return COUNTRIES[(code as CountryCode) ?? 'NG'] ?? COUNTRIES.NG
}

// Convertit un code pays ISO 3166-1 alpha-2 (ex: header x-vercel-ip-country)
// en code interne CountryCode. Tous nos codes (Afrique, UE, US, CA)
// correspondent directement à l'ISO 3166-1 alpha-2 — chaque pays de l'UE a
// son propre code depuis la V3, plus de regroupement "EU". Pays inconnu →
// 'NG' (marché principal du produit), pour ne jamais laisser un
// utilisateur sans devise.
export function detectCountryFromIso(iso: string | null | undefined): CountryCode {
  if (!iso) return 'NG'
  const code = iso.toUpperCase()
  if (code in COUNTRIES) return code as CountryCode
  return 'NG'
}

export function formatPrice(amount: number, country: CountryConfig): string {
  const { currency, currencySymbol } = country
  if (currency === 'XAF' || currency === 'XOF')
    return `${amount.toLocaleString('fr-FR')} FCFA/mois`
  if (currency === 'EUR')
    return `${amount.toFixed(2).replace('.', ',')} €/mois`
  if (currency === 'USD')
    return `$${amount.toFixed(2)}/mo`
  if (currency === 'CAD')
    return `CA$${amount.toFixed(2)}/mo`
  if (currency === 'NGN')
    return `₦${amount.toLocaleString('en-NG')}/mo`
  if (currency === 'GHS')
    return `GH₵${amount}/mo`
  if (currency === 'GNF')
    return `${amount.toLocaleString('fr-FR')} FG/mois`
  if (currency === 'GMD')
    return `D ${amount}/mo`
  if (currency === 'SLE')
    return `Le ${amount}/mo`
  if (currency === 'LRD')
    return `L$${amount.toLocaleString('en-US')}/mo`
  if (currency === 'CVE')
    return `${amount.toLocaleString('fr-FR')} Esc/mois`
  if (currency === 'MRU')
    return `${amount} UM/mois`
  if (currency === 'CDF')
    return `${amount.toLocaleString('fr-FR')} FC/mois`
  return `${currencySymbol}${amount}/mo`
}
