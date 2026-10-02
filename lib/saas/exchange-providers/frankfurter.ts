import type { ExchangeRateProvider, ProviderResult, ProviderRangeResult } from './types'
import { SUPPORTED_CURRENCY_CODES } from '../currencies'

// Frankfurter v2 (https://frankfurter.dev) — agrège ~97 banques centrales et
// sources officielles (BCE pour l'EUR, Banque centrale du Nigeria pour le
// NGN, etc.), 165 devises, historique quotidien depuis 1998-99 pour les
// devises CFA/Afrique de l'Ouest. Gratuit, sans clé.
//
// Vérifié empiriquement (2026-09-11, pas seulement documenté) sur v2 pour
// TOUTES les devises StockShop — EUR/NGN, EUR/XAF, EUR/XOF, EUR/GHS,
// USD/NGN et les 19 devises non-USD en un seul appel groupé — taux réels
// retournés sur toute la fenêtre avril-septembre 2026. C'est la V1
// (`/v1/...`, ~30 devises, PAS d'Afrique) qui était utilisée avant migration
// 146 : v2 la remplace entièrement, plus besoin de garder les deux.
//
// Endpoint unique `/v2/rates`, 3 usages selon les paramètres :
//   ?base=X&quotes=Y                       → taux courant (le plus récent)
//   ?base=X&quotes=Y&date=YYYY-MM-DD       → taux d'UNE date passée
//   ?base=X&quotes=Y&from=A&to=B           → série sur une PLAGE (backfill)
// Le week-end / jour férié, certaines devises (calées sur le calendrier
// BCE : XAF/XOF/GHS…) n'ont pas de cotation ce jour-là — Frankfurter renvoie
// alors la dernière date ouvrée dans son propre champ `date`, mais ce repli
// n'est PAS cohérent d'une devise à l'autre (le NGN, par ex., a parfois une
// cotation le samedi). On ne s'appuie donc jamais sur ce repli : chaque
// point est stocké sous la date RÉELLEMENT renvoyée, et c'est notre propre
// requête « dernier effective_date ≤ date demandée » qui gère les trous,
// de façon homogène quelle que soit la devise (voir exchange-service.ts).
const BASE_URL = 'https://api.frankfurter.dev/v2/rates'

const FRANKFURTER_SET = new Set(SUPPORTED_CURRENCY_CODES.filter((c) => c !== 'USD'))

function toRatesToUsd(quotes: Record<string, unknown>): Array<{ currency: string; rate: number }> {
  // quotes[CUR] = nombre de CUR pour 1 USD (base=usd)  →  CUR→USD = 1 / ça
  const rates = [{ currency: 'USD', rate: 1 }]
  for (const [cur, perUsd] of Object.entries(quotes)) {
    const n = Number(perUsd)
    if (n > 0 && Number.isFinite(n)) rates.push({ currency: cur, rate: 1 / n })
  }
  return rates
}

export class FrankfurterProvider implements ExchangeRateProvider {
  readonly name = 'frankfurter'

  supports(currency: string): boolean {
    return FRANKFURTER_SET.has(currency)
  }

  supportsHistorical(currency: string): boolean {
    return FRANKFURTER_SET.has(currency)
  }

  async fetchRatesToUsd(currencies: string[], signal?: AbortSignal): Promise<ProviderResult> {
    const wanted = currencies.filter((c) => c !== 'USD' && this.supports(c))
    if (wanted.length === 0) {
      return { provider: this.name, effective_date: new Date().toISOString().slice(0, 10), fetched_at: new Date().toISOString(), rates: [{ currency: 'USD', rate: 1 }] }
    }

    const url = `${BASE_URL}?base=usd&quotes=${wanted.join(',').toLowerCase()}`
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j: any = await res.json()
    if (!Array.isArray(j)) throw new Error('réponse v2 inattendue (tableau attendu)')

    // v2 peut renvoyer une date différente par devise dans un même appel
    // (confirmé : EUR parfois 1 jour "en avance" sur NGN/XAF dans le même
    // batch). On retient la date la PLUS ANCIENNE du lot comme
    // `effective_date` global — jamais optimiste, ne surestime jamais la
    // fraîcheur du batch entier (rateFreshness() s'appuie dessus).
    const quotes: Record<string, number> = {}
    let oldestDate: string | null = null
    for (const entry of j) {
      if (typeof entry?.quote === 'string' && Number.isFinite(Number(entry.rate))) {
        quotes[entry.quote] = Number(entry.rate)
        if (typeof entry.date === 'string' && (oldestDate === null || entry.date < oldestDate)) {
          oldestDate = entry.date
        }
      }
    }

    return {
      provider: this.name,
      effective_date: oldestDate ?? new Date().toISOString().slice(0, 10),
      fetched_at: new Date().toISOString(),
      rates: toRatesToUsd(quotes),
    }
  }

  async fetchHistoricalRatesToUsd(currencies: string[], date: string, signal?: AbortSignal): Promise<ProviderResult> {
    const wanted = currencies.filter((c) => c !== 'USD' && this.supports(c))
    const fetchedAt = new Date().toISOString()
    if (wanted.length === 0) {
      return { provider: this.name, effective_date: date, fetched_at: fetchedAt, rates: [{ currency: 'USD', rate: 1 }] }
    }

    const url = `${BASE_URL}?base=usd&quotes=${wanted.join(',').toLowerCase()}&date=${date}`
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j: any = await res.json()
    if (!Array.isArray(j)) throw new Error('réponse v2 inattendue (tableau attendu)')

    // Toutes les devises d'un même appel ?date= partagent en principe la
    // même date renvoyée — sauf repli différent par devise (voir commentaire
    // de tête). On regroupe donc par date réelle plutôt que de supposer une
    // seule effective_date pour tout l'appel.
    const byDate: Record<string, Record<string, number>> = {}
    for (const entry of j) {
      if (typeof entry?.quote !== 'string' || !Number.isFinite(Number(entry.rate))) continue
      const d: string = typeof entry.date === 'string' ? entry.date : date
      ;(byDate[d] ??= {})[entry.quote] = Number(entry.rate)
    }
    // Cas normal (même date pour toutes) : une seule clé — on la retourne
    // directement. Cas de repli hétérogène : on retient la date la plus
    // proche de celle demandée (la plus grande ≤ date demandée), le reste
    // sera couvert par un futur backfill si nécessaire — fetchHistoricalRangeToUsd
    // est la voie recommandée pour un backfill multi-devises cohérent.
    const dates = Object.keys(byDate).sort()
    const chosen = dates.filter((d) => d <= date).pop() ?? dates[dates.length - 1] ?? date

    return {
      provider: this.name,
      effective_date: chosen,
      fetched_at: fetchedAt,
      rates: toRatesToUsd(byDate[chosen] ?? {}),
    }
  }

  async fetchHistoricalRangeToUsd(
    currencies: string[],
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ProviderRangeResult> {
    const wanted = currencies.filter((c) => c !== 'USD' && this.supports(c))
    const fetchedAt = new Date().toISOString()
    if (wanted.length === 0) return { provider: this.name, fetched_at: fetchedAt, points: [] }

    const url = `${BASE_URL}?base=usd&quotes=${wanted.join(',').toLowerCase()}&from=${from}&to=${to}`
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const j: any = await res.json()
    if (!Array.isArray(j)) throw new Error('réponse v2 inattendue (tableau attendu)')

    const points = j
      .filter((entry: any) => typeof entry?.quote === 'string' && typeof entry?.date === 'string' && Number.isFinite(Number(entry.rate)))
      .map((entry: any) => ({
        currency: entry.quote as string,
        effective_date: entry.date as string,
        rate: 1 / Number(entry.rate), // quote = nombre de CUR pour 1 USD → inverse
      }))

    return { provider: this.name, fetched_at: fetchedAt, points }
  }
}
