// Abstraction de fournisseur de taux de change.
//
// Objectif : ne coupler le module de reporting à AUCUN fournisseur en
// particulier. Ajouter Frankfurter, ExchangeRate-API, CurrencyFreaks… =
// une classe qui implémente cette interface, rien d'autre à réécrire.
//
// Tous les taux sont normalisés en « 1 <devise> = rate USD » (pivot USD).
//
// Historique (migration 146+) : un fournisseur peut EN PLUS savoir coter le
// passé. C'est optionnel sur l'interface — un fournisseur qui n'a que le
// taux courant (ex. er-api, offre gratuite) reste valide, le service appelant
// (exchange-backfill.ts) saute simplement les fournisseurs qui n'implémentent
// pas ces méthodes plutôt que d'échouer.

export interface ProviderRate {
  /** Code ISO de la devise. */
  currency: string
  /** 1 <currency> = rate USD. */
  rate: number
}

export interface ProviderResult {
  provider: string
  /** Date de validité du taux côté fournisseur (YYYY-MM-DD). */
  effective_date: string
  /** Horodatage de l'appel réseau (ISO). */
  fetched_at: string
  rates: ProviderRate[]
}

/** Un point de taux historique : une devise, une date, un taux. */
export interface ProviderRatePoint {
  currency: string
  /** YYYY-MM-DD — date de validité côté fournisseur (jamais un jour futur). */
  effective_date: string
  /** 1 <currency> = rate USD. */
  rate: number
}

export interface ProviderRangeResult {
  provider: string
  fetched_at: string
  points: ProviderRatePoint[]
}

export interface ExchangeRateProvider {
  /** Identifiant stable, stocké dans exchange_rates.provider. */
  readonly name: string
  /** Ce fournisseur sait-il coter cette devise (taux courant) ? */
  supports(currency: string): boolean
  /**
   * Récupère les taux <currency> → USD pour les devises demandées que ce
   * fournisseur supporte. Lève une erreur si l'appel échoue (le service
   * appelant gère le fallback / le fournisseur suivant).
   */
  fetchRatesToUsd(currencies: string[], signal?: AbortSignal): Promise<ProviderResult>

  /** Ce fournisseur sait-il coter cette devise pour une date PASSÉE ? Absent
   *  ou renvoyant `false` = pas de capacité historique (ex. er-api gratuit). */
  supportsHistorical?(currency: string): boolean
  /** Taux <currency> → USD pour UNE date précise (YYYY-MM-DD). */
  fetchHistoricalRatesToUsd?(
    currencies: string[],
    date: string,
    signal?: AbortSignal,
  ): Promise<ProviderResult>
  /**
   * Taux <currency> → USD sur une PLAGE de dates, en un minimum d'appels
   * réseau (idéalement un seul) — c'est la méthode utilisée par le backfill,
   * jamais un appel par jour ni par devise.
   */
  fetchHistoricalRangeToUsd?(
    currencies: string[],
    from: string,
    to: string,
    signal?: AbortSignal,
  ): Promise<ProviderRangeResult>
}
