import type { ExchangeRateProvider, ProviderResult } from './types'

// ExchangeRate-API — endpoint « open access » (https://open.er-api.com).
// Gratuit, sans clé, ~160 devises, mise à jour quotidienne. Couvre TOUTES
// les devises de StockShop, y compris NGN, GHS, XAF, XOF, CDF, GNF, GMD,
// SLE, LRD, CVE, MRU.
//
// Si un jour on passe à l'endpoint authentifié (v6/<KEY>/latest/USD), la
// clé viendra de process.env.EXCHANGERATE_API_KEY — jamais du frontend.
export class ErApiProvider implements ExchangeRateProvider {
  readonly name = 'er-api'

  // On tente pour toute devise ; une devise réellement absente du payload
  // sera simplement omise du résultat (et retombera sur le fallback DB).
  supports(_currency: string): boolean {
    return true
  }

  async fetchRatesToUsd(currencies: string[], signal?: AbortSignal): Promise<ProviderResult> {
    const key = process.env.EXCHANGERATE_API_KEY
    const url = key
      ? `https://v6.exchangerate-api.com/v6/${key}/latest/USD`
      : 'https://open.er-api.com/v6/latest/USD'

    const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j: any = await res.json()
    if (j?.result !== 'success' || !j?.rates) throw new Error(`result=${j?.result ?? 'inconnu'}`)

    // j.rates[CUR] = nombre de CUR pour 1 USD  →  CUR→USD = 1 / ça
    const rates: Array<{ currency: string; rate: number }> = []
    for (const c of currencies) {
      if (c === 'USD') { rates.push({ currency: 'USD', rate: 1 }); continue }
      const perUsd = Number(j.rates[c])
      if (perUsd > 0 && Number.isFinite(perUsd)) rates.push({ currency: c, rate: 1 / perUsd })
    }

    const src: string = j.time_last_update_utc || j.time_last_update_unix
    const effDate = src
      ? new Date(typeof src === 'number' ? src * 1000 : src).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    return { provider: this.name, effective_date: effDate, fetched_at: new Date().toISOString(), rates }
  }
}
