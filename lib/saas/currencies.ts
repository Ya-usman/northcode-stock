import { COUNTRIES, getCountry } from './countries'

// Devises supportées par StockShop.
//
// La CLÉ MÉTIER est le CODE ISO (`NGN`, `XOF`, `XAF`, `EUR`…) — stable, non
// ambigu (XOF ≠ XAF alors qu'ils partagent le symbole « F CFA »), et
// indépendant de toute chaîne d'affichage. Le symbole n'est qu'un libellé.
//
// ⚠️ `shops.currency` stocke encore le SYMBOLE (dette historique, utilisée
// partout dans l'app pour l'affichage). Le module Parrainage, lui, résout
// toujours la devise depuis `shops.country` via `currencyCodeForCountry()`
// et stocke des codes ISO dans `referral_wallets.currency` /
// `referral_program_config.min_payout_by_currency`. La migration complète
// de `shops.currency` vers ISO est un chantier V2 (voir memory projet).

export interface CurrencyRef {
  /** Code ISO 4217 — clé métier. */
  code: string
  /** Symbole d'affichage. */
  symbol: string
  /** Libellé lisible pour l'admin. */
  label: string
}

const CURRENCY_NAMES: Record<string, string> = {
  NGN: 'Naira', XOF: 'Franc CFA (Afrique de l’Ouest)', XAF: 'Franc CFA (Afrique centrale)',
  GHS: 'Cedi ghanéen', GNF: 'Franc guinéen', GMD: 'Dalasi', SLE: 'Leone', LRD: 'Dollar libérien',
  CVE: 'Escudo cap-verdien', MRU: 'Ouguiya', CDF: 'Franc congolais', EUR: 'Euro',
  USD: 'Dollar américain', CAD: 'Dollar canadien',
}

function buildCurrencies(): CurrencyRef[] {
  const byCode = new Map<string, string>() // code ISO -> symbole
  for (const c of Object.values(COUNTRIES)) {
    if (!byCode.has(c.currency)) byCode.set(c.currency, c.currencySymbol)
  }
  return Array.from(byCode.entries())
    .map(([code, symbol]) => ({ code, symbol, label: `${CURRENCY_NAMES[code] ?? code} — ${code} (${symbol})` }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

/** Toutes les devises supportées, indexées par code ISO. */
export const REFERRAL_CURRENCIES: CurrencyRef[] = buildCurrencies()

const SYMBOL_BY_CODE: Record<string, string> = Object.fromEntries(REFERRAL_CURRENCIES.map((c) => [c.code, c.symbol]))
const SUPPORTED_CODES = new Set(REFERRAL_CURRENCIES.map((c) => c.code))

/** Codes ISO de toutes les devises supportées par StockShop. */
export const SUPPORTED_CURRENCY_CODES: string[] = REFERRAL_CURRENCIES.map((c) => c.code)

/** Code ISO de la devise d'un pays (`getCountry` est la source de vérité). */
export function currencyCodeForCountry(countryCode: string | null | undefined): string {
  return getCountry(countryCode || 'NG').currency
}

/** Symbole d'affichage pour un code ISO (repli : le code lui-même). */
export function currencySymbol(code: string | null | undefined): string {
  if (!code) return ''
  return SYMBOL_BY_CODE[code] ?? code
}

export function isSupportedCurrencyCode(code: string | null | undefined): boolean {
  return !!code && SUPPORTED_CODES.has(code)
}
