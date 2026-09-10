// Abstraction de fournisseur de taux de change.
//
// Objectif : ne coupler le module de reporting à AUCUN fournisseur en
// particulier. Ajouter Frankfurter, ExchangeRate-API, CurrencyFreaks… =
// une classe qui implémente cette interface, rien d'autre à réécrire.
//
// Tous les taux sont normalisés en « 1 <devise> = rate USD » (pivot USD).

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

export interface ExchangeRateProvider {
  /** Identifiant stable, stocké dans exchange_rates.provider. */
  readonly name: string
  /** Ce fournisseur sait-il coter cette devise ? */
  supports(currency: string): boolean
  /**
   * Récupère les taux <currency> → USD pour les devises demandées que ce
   * fournisseur supporte. Lève une erreur si l'appel échoue (le service
   * appelant gère le fallback / le fournisseur suivant).
   */
  fetchRatesToUsd(currencies: string[], signal?: AbortSignal): Promise<ProviderResult>
}
