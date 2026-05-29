export type CountryCode = 'NG' | 'CM' | 'CI' | 'ML' | 'NE' | 'SN' | 'BJ' | 'TG' | 'EU' | 'US' | 'CA'
export type BillingPeriod = 'monthly' | 'quarterly' | 'annual'

export const BILLING_PERIODS: Record<BillingPeriod, { months: number; days: number; discount: number; label: string; badge?: string }> = {
  monthly:   { months: 1,  days: 31,  discount: 0,    label: 'Mensuel' },
  quarterly: { months: 3,  days: 92,  discount: 0.10, label: 'Trimestriel', badge: '-10%' },
  annual:    { months: 12, days: 365, discount: 0.25, label: 'Annuel',      badge: '-25%' },
}

export function getPeriodPrice(baseMonthlyPrice: number, period: BillingPeriod): number {
  const cfg = BILLING_PERIODS[period]
  return Math.floor(baseMonthlyPrice * cfg.months * (1 - cfg.discount))
}

export function getPeriodDays(period: BillingPeriod): number {
  return BILLING_PERIODS[period].days
}

export type PaymentMethodType = 'cash' | 'mobile_money' | 'transfer' | 'card' | 'credit'

export interface PaymentMethod {
  id: string
  label: string
  icon: string
  logo?: string  // chemin dans /public/payment/
  type: PaymentMethodType
}

export interface CountryConfig {
  code: CountryCode
  name: string
  flag: string
  /** Primary flag color used for UI accents (border, bg tint) */
  flagColor: string
  currency: string
  currencySymbol: string
  gateway: 'paystack' | 'flutterwave' | 'notchpay' | 'stripe'
  prices: {
    starter: number
    pro: number
    business: number
  }
  phonePrefix: string
  cityPlaceholder: string
  paymentMethods: PaymentMethod[]
}

export function getMethodType(methodId: string, country: CountryConfig): PaymentMethodType {
  return country.paymentMethods.find(m => m.id === methodId)?.type ?? 'cash'
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  NG: {
    code: 'NG', name: 'Nigeria', flag: '🇳🇬', flagColor: '#008751',
    currency: 'NGN', currencySymbol: '₦', gateway: 'paystack',
    prices: { starter: 4999, pro: 9999, business: 19999 },
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
    prices: { starter: 5000, pro: 8000, business: 15000 },
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
    prices: { starter: 5000, pro: 8000, business: 15000 },
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
    prices: { starter: 5000, pro: 8000, business: 15000 },
    phonePrefix: '+223', cityPlaceholder: 'Bamako, Sikasso, Ségou…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'orange_money', label: 'Orange Money', icon: '🟠', logo: '/payment/orange_money.jpg', type: 'mobile_money' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',         type: 'mobile_money' },
      { id: 'moov_money',   label: 'Moov Money',   icon: '📱', logo: '/payment/moov_money.png',   type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },
  NE: {
    code: 'NE', name: 'Niger', flag: '🇳🇪', flagColor: '#E05206',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 8000, business: 15000 },
    phonePrefix: '+227', cityPlaceholder: 'Niamey, Zinder, Maradi…',
    paymentMethods: [
      { id: 'cash',         label: 'Espèces',      icon: '💵', type: 'cash' },
      { id: 'amana',        label: 'Amana',        icon: '📱', logo: '/payment/amana.png',       type: 'mobile_money' },
      { id: 'wave',         label: 'Wave',         icon: '🌊', logo: '/payment/wave.png',        type: 'mobile_money' },
      { id: 'nita',         label: 'NITA',         icon: '📱', logo: '/payment/nita.png',        type: 'mobile_money' },
      { id: 'airtel_money', label: 'Airtel Money', icon: '📱', logo: '/payment/airtel_money.png', type: 'mobile_money' },
      { id: 'transfer',     label: 'Virement',     icon: '🏦', type: 'transfer' },
      { id: 'credit',       label: 'Crédit',       icon: '📝', type: 'credit' },
    ],
  },
  SN: {
    code: 'SN', name: 'Sénégal', flag: '🇸🇳', flagColor: '#00853F',
    currency: 'XOF', currencySymbol: 'F CFA', gateway: 'flutterwave',
    prices: { starter: 5000, pro: 8000, business: 15000 },
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
    prices: { starter: 5000, pro: 8000, business: 15000 },
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
    prices: { starter: 5000, pro: 8000, business: 15000 },
    phonePrefix: '+228', cityPlaceholder: 'Lomé, Sokodé, Kara…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces', icon: '💵', type: 'cash' },
      { id: 'flooz',    label: 'Flooz',   icon: '📱', type: 'mobile_money' },
      { id: 'tmoney',   label: 'T-Money', icon: '📱', logo: '/payment/tmoney.jpg', type: 'mobile_money' },
      { id: 'transfer', label: 'Virement',icon: '🏦', type: 'transfer' },
      { id: 'credit',   label: 'Crédit',  icon: '📝', type: 'credit' },
    ],
  },
  EU: {
    code: 'EU', name: 'Europe', flag: '🇪🇺', flagColor: '#003399',
    currency: 'EUR', currencySymbol: '€', gateway: 'stripe',
    prices: { starter: 5, pro: 10, business: 20 },
    phonePrefix: '+', cityPlaceholder: 'Paris, Berlin, Madrid…',
    paymentMethods: [
      { id: 'cash',     label: 'Espèces',        icon: '💵', type: 'cash' },
      { id: 'card',     label: 'Carte bancaire',  icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Virement',        icon: '🏦', type: 'transfer' },
      { id: 'paypal',   label: 'PayPal',          icon: '🔵', type: 'card' },
      { id: 'credit',   label: 'Crédit',          icon: '📝', type: 'credit' },
    ],
  },
  US: {
    code: 'US', name: 'United States', flag: '🇺🇸', flagColor: '#B22234',
    currency: 'USD', currencySymbol: '$', gateway: 'stripe',
    prices: { starter: 5, pro: 10, business: 20 },
    phonePrefix: '+1', cityPlaceholder: 'New York, Los Angeles, Chicago…',
    paymentMethods: [
      { id: 'cash',     label: 'Cash',           icon: '💵', type: 'cash' },
      { id: 'card',     label: 'Credit / Debit',  icon: '💳', type: 'card' },
      { id: 'transfer', label: 'Bank Transfer',   icon: '🏦', type: 'transfer' },
      { id: 'paypal',   label: 'PayPal',          icon: '🔵', type: 'card' },
      { id: 'zelle',    label: 'Zelle',           icon: '📱', type: 'mobile_money' },
      { id: 'venmo',    label: 'Venmo',           icon: '📱', type: 'mobile_money' },
      { id: 'credit',   label: 'Credit',          icon: '📝', type: 'credit' },
    ],
  },
  CA: {
    code: 'CA', name: 'Canada', flag: '🇨🇦', flagColor: '#FF0000',
    currency: 'CAD', currencySymbol: 'CA$', gateway: 'stripe',
    prices: { starter: 7, pro: 14, business: 27 },
    phonePrefix: '+1', cityPlaceholder: 'Toronto, Montréal, Vancouver…',
    paymentMethods: [
      { id: 'cash',       label: 'Cash',           icon: '💵', type: 'cash' },
      { id: 'card',       label: 'Credit / Debit',  icon: '💳', type: 'card' },
      { id: 'etransfer',  label: 'e-Transfer',      icon: '🏦', type: 'transfer' },
      { id: 'paypal',     label: 'PayPal',          icon: '🔵', type: 'card' },
      { id: 'credit',     label: 'Credit',          icon: '📝', type: 'credit' },
    ],
  },
}

export function getCountry(code: string | null | undefined): CountryConfig {
  return COUNTRIES[(code as CountryCode) ?? 'NG'] ?? COUNTRIES.NG
}

export function formatPrice(amount: number, country: CountryConfig): string {
  if (country.currency === 'XAF' || country.currency === 'XOF') {
    return `${amount.toLocaleString('fr-FR')} FCFA/mois`
  }
  if (country.currency === 'EUR') return `${amount.toLocaleString('fr-FR')} €/mois`
  if (country.currency === 'USD') return `$${amount}/mo`
  if (country.currency === 'CAD') return `CA$${amount}/mo`
  return `₦${amount.toLocaleString('en-NG')}/mo`
}
