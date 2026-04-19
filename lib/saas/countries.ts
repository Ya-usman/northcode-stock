export type CountryCode = 'NG' | 'CM' | 'CI' | 'ML' | 'NE' | 'BJ' | 'TG'
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

export interface CountryConfig {
  code: CountryCode
  name: string
  flag: string
  /** Primary flag color used for UI accents (border, bg tint) */
  flagColor: string
  currency: string
  currencySymbol: string
  gateway: 'paystack' | 'flutterwave'
  prices: {
    starter: number
    pro: number
    business: number
  }
  phonePrefix: string
  cityPlaceholder: string
}

export const COUNTRIES: Record<CountryCode, CountryConfig> = {
  NG: {
    code: 'NG',
    name: 'Nigeria',
    flag: '🇳🇬',
    flagColor: '#008751',
    currency: 'NGN',
    currencySymbol: '₦',
    gateway: 'paystack',
    prices: { starter: 4999, pro: 9999, business: 19999 },
    phonePrefix: '+234',
    cityPlaceholder: 'Lagos, Kano, Abuja…',
  },
  CM: {
    code: 'CM',
    name: 'Cameroun',
    flag: '🇨🇲',
    flagColor: '#CE1126',
    currency: 'XAF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+237',
    cityPlaceholder: 'Douala, Yaoundé, Bafoussam…',
  },
  CI: {
    code: 'CI',
    name: "Côte d'Ivoire",
    flag: '🇨🇮',
    flagColor: '#F77F00',
    currency: 'XOF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+225',
    cityPlaceholder: 'Abidjan, Bouaké, San-Pédro…',
  },
  ML: {
    code: 'ML',
    name: 'Mali',
    flag: '🇲🇱',
    flagColor: '#FCD116',
    currency: 'XOF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+223',
    cityPlaceholder: 'Bamako, Sikasso, Ségou…',
  },
  NE: {
    code: 'NE',
    name: 'Niger',
    flag: '🇳🇪',
    flagColor: '#E05206',
    currency: 'XOF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+227',
    cityPlaceholder: 'Niamey, Zinder, Maradi…',
  },
  BJ: {
    code: 'BJ',
    name: 'Bénin',
    flag: '🇧🇯',
    flagColor: '#008751',
    currency: 'XOF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+229',
    cityPlaceholder: 'Cotonou, Porto-Novo, Parakou…',
  },
  TG: {
    code: 'TG',
    name: 'Togo',
    flag: '🇹🇬',
    flagColor: '#D21034',
    currency: 'XOF',
    currencySymbol: 'FCFA',
    gateway: 'flutterwave',
    prices: { starter: 1999, pro: 4999, business: 9999 },
    phonePrefix: '+228',
    cityPlaceholder: 'Lomé, Sokodé, Kara…',
  },
}

export function getCountry(code: string | null | undefined): CountryConfig {
  return COUNTRIES[(code as CountryCode) ?? 'NG'] ?? COUNTRIES.NG
}

export function formatPrice(amount: number, country: CountryConfig): string {
  if (country.currency === 'XAF' || country.currency === 'XOF') {
    return `${amount.toLocaleString('fr-FR')} FCFA/mois`
  }
  return `₦${amount.toLocaleString('en-NG')}/mo`
}
