import type { ExchangeRateProvider, ProviderResult } from './types'

// Frankfurter (https://frankfurter.dev) — taux de référence de la BCE.
// Gratuit, sans clé. Ne couvre PAS les devises d'Afrique de l'Ouest /
// Centrale ni le Naira (NGN, GHS, XAF, XOF…) — d'où la présence d'un
// second fournisseur (er-api) dans la chaîne.
const FRANKFURTER_SET = new Set([
  'EUR', 'USD', 'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'ZAR',
])

export class FrankfurterProvider implements ExchangeRateProvider {
  readonly name = 'frankfurter'

  supports(currency: string): boolean {
    return FRANKFURTER_SET.has(currency)
  }

  async fetchRatesToUsd(currencies: string[], signal?: AbortSignal): Promise<ProviderResult> {
    const wanted = currencies.filter((c) => c !== 'USD' && this.supports(c))
    if (wanted.length === 0) {
      return { provider: this.name, effective_date: new Date().toISOString().slice(0, 10), fetched_at: new Date().toISOString(), rates: [{ currency: 'USD', rate: 1 }] }
    }

    const url = `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${wanted.join(',')}`
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j: any = await res.json()
    if (!j?.rates) throw new Error('réponse sans "rates"')

    // j.rates[CUR] = nombre de CUR pour 1 USD  →  CUR→USD = 1 / ça
    const rates = [{ currency: 'USD', rate: 1 }]
    for (const [cur, perUsd] of Object.entries(j.rates)) {
      const n = Number(perUsd)
      if (n > 0 && Number.isFinite(n)) rates.push({ currency: cur, rate: 1 / n })
    }

    return {
      provider: this.name,
      effective_date: typeof j.date === 'string' ? j.date : new Date().toISOString().slice(0, 10),
      fetched_at: new Date().toISOString(),
      rates,
    }
  }
}
