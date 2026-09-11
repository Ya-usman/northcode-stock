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

export type BillingPeriod = 'monthly' | 'quarterly' | 'annual'

export const BILLING_PERIODS: Record<BillingPeriod, { months: number; days: number; discount: number; label: string; badge?: string }> = {
  monthly:   { months: 1,  days: 31,  discount: 0,    label: 'Mensuel' },
  quarterly: { months: 3,  days: 92,  discount: 0.08, label: 'Trimestriel', badge: '-8%' },
  annual:    { months: 12, days: 365, discount: 0.20, label: 'Annuel',      badge: '-20%' },
}

export function getPeriodPrice(
  baseMonthlyPrice: number,
  period: BillingPeriod,
  overrides?: PeriodPriceOverrides,
): number {
  if (period === 'monthly') return baseMonthlyPrice
  if (period === 'quarterly' && overrides?.quarterly != null) return overrides.quarterly
  if (period === 'annual'    && overrides?.annual    != null) return overrides.annual
  const cfg = BILLING_PERIODS[period]
  return Math.ceil(baseMonthlyPrice * cfg.months * (1 - cfg.discount))
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

export interface PeriodPriceOverrides {
  quarterly?: number
  annual?: number
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
  prices: {
    starter: number
    pro: number
    business: number
  }
  /** Explicit per-period prices — takes priority over the formula */
  periodPrices?: {
    starter?: PeriodPriceOverrides
    pro?: PeriodPriceOverrides
    business?: PeriodPriceOverrides
  }
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

// Shared periodPrices for XOF/XAF countries at 4999/7999/14999 F CFA/mois (-8% / -20%)
const FCFA_PERIOD_PRICES = {
  starter:  { quarterly: 13999,  annual: 47999  },
  pro:      { quarterly: 21999,  annual: 76999  },
  business: { quarterly: 41999,  annual: 143999 },
}

// Shared periodPrices for EUR/USD/CAD countries at 14.99/19.99/29.99/mo (-8% / -20%)
const INTL_PERIOD_PRICES = {
  starter:  { quarterly: 41.99,  annual: 143.99 },
  pro:      { quarterly: 54.99,  annual: 191.99 },
  business: { quarterly: 82.99,  annual: 287.99 },
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
    prices: { starter: 14.99, pro: 19.99, business: 29.99 },
    periodPrices: INTL_PERIOD_PRICES,
    phonePrefix, cityPlaceholder,
    paymentMethods: EU_PAYMENT_METHODS,
  }
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {

  // ── Afrique de l'Ouest — zone FCFA (XOF / XAF) ──────────────────────────

  NG: {
    code: 'NG', name: 'Nigeria', flag: '🇳🇬', flagColor: '#008751',
    currency: 'NGN', currencySymbol: '₦', gateway: 'paystack',
    prices: { starter: 4999, pro: 9999, business: 19999 },
    periodPrices: {
      starter:  { quarterly: 13999, annual: 47999  },
      pro:      { quarterly: 27999, annual: 99999  },
      business: { quarterly: 54999, annual: 199999 },
    },
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 129, pro: 199, business: 379 },
    periodPrices: {
      starter:  { quarterly: 359.99,  annual: 1239.99  },
      pro:      { quarterly: 549.99,  annual: 1909.99  },
      business: { quarterly: 1049.99, annual: 3639.99  },
    },
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
    prices: { starter: 70000, pro: 115000, business: 215000 },
    periodPrices: {
      starter:  { quarterly: 193999,  annual: 671999   },
      pro:      { quarterly: 317999,  annual: 1099999  },
      business: { quarterly: 594999,  annual: 2059999  },
    },
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 549, pro: 899, business: 1699 },
    periodPrices: {
      starter:  { quarterly: 1519,  annual: 5279  },
      pro:      { quarterly: 2499,  annual: 8649  },
      business: { quarterly: 4699,  annual: 16319 },
    },
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
    prices: { starter: 189, pro: 299, business: 569 },
    periodPrices: {
      starter:  { quarterly: 529,  annual: 1819 },
      pro:      { quarterly: 829,  annual: 2879 },
      business: { quarterly: 1579, annual: 5469 },
    },
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
    prices: { starter: 1599, pro: 2599, business: 4899 },
    periodPrices: {
      starter:  { quarterly: 4449,  annual: 15399 },
      pro:      { quarterly: 7199,  annual: 24999 },
      business: { quarterly: 13599, annual: 46999 },
    },
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
    prices: { starter: 849, pro: 1349, business: 2499 },
    periodPrices: {
      starter:  { quarterly: 2349,  annual: 8199  },
      pro:      { quarterly: 3749,  annual: 12999 },
      business: { quarterly: 6899,  annual: 23999 },
    },
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
    prices: { starter: 319, pro: 499, business: 949 },
    periodPrices: {
      starter:  { quarterly: 889,  annual: 3069 },
      pro:      { quarterly: 1389, annual: 4799 },
      business: { quarterly: 2629, annual: 9119 },
    },
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
    prices: { starter: 23999, pro: 37999, business: 69999 },
    periodPrices: {
      starter:  { quarterly: 65999,  annual: 229999 },
      pro:      { quarterly: 104999, annual: 364999 },
      business: { quarterly: 192999, annual: 671999 },
    },
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 4999, pro: 7999, business: 14999 },
    periodPrices: FCFA_PERIOD_PRICES,
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
    prices: { starter: 14.99, pro: 19.99, business: 29.99 },
    periodPrices: INTL_PERIOD_PRICES,
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
    prices: { starter: 14.99, pro: 19.99, business: 29.99 },
    periodPrices: INTL_PERIOD_PRICES,
    phonePrefix: '+1', cityPlaceholder: 'Toronto, Montréal, Vancouver…',
    paymentMethods: [
      { id: 'cash',      label: 'Cash',           icon: '💵', type: 'cash' },
      { id: 'card',      label: 'Credit / Debit', icon: '💳', type: 'card' },
      { id: 'etransfer', label: 'e-Transfer',     icon: '🏦', type: 'transfer' },
      { id: 'paypal',    label: 'PayPal',         icon: '🔵', type: 'card' },
      { id: 'credit',    label: 'Credit',         icon: '📝', type: 'credit' },
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
