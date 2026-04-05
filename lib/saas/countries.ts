export type CountryCode = 'NG' | 'CM'

export interface CountryConfig {
  code: CountryCode
  name: string
  flag: string
  currency: string
  currencySymbol: string
  gateway: 'paystack' | 'notchpay'
  /** Price multiplier vs NGN base prices */
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
    currency: 'XAF',
    currencySymbol: 'FCFA',
    gateway: 'notchpay',
    prices: { starter: 1999, pro: 3999, business: 7999 },
    phonePrefix: '+237',
    cityPlaceholder: 'Douala, Yaoundé, Bafoussam…',
  },
}

export function getCountry(code: string | null | undefined): CountryConfig {
  return COUNTRIES[(code as CountryCode) ?? 'NG'] ?? COUNTRIES.NG
}

export function formatPrice(amount: number, country: CountryConfig): string {
  if (country.currency === 'XAF') {
    return `${amount.toLocaleString('fr-FR')} FCFA/mois`
  }
  return `₦${amount.toLocaleString('en-NG')}/mo`
}
