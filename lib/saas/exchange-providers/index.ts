import type { ExchangeRateProvider } from './types'
import { FrankfurterProvider } from './frankfurter'
import { ErApiProvider } from './er-api'

export type { ExchangeRateProvider, ProviderRate, ProviderResult } from './types'

// Ordre de PRIORITÉ : pour chaque devise, on prend le premier fournisseur
// (dans cet ordre) qui sait la coter. Frankfurter d'abord (taux BCE pour
// EUR/USD/CAD…), er-api ensuite pour tout le reste (devises africaines).
export const EXCHANGE_PROVIDERS: ExchangeRateProvider[] = [
  new FrankfurterProvider(),
  new ErApiProvider(),
]
