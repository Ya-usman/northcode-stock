import { COUNTRIES } from './countries'

// Devises supportées par StockShop, dérivées de la liste des pays (source
// unique de vérité — lib/saas/countries.ts). La CLÉ métier est le SYMBOLE
// (`₦`, `F CFA`, `€`…) car c'est ce que `shops.currency` — et donc
// `referral_wallets.currency` — stocke partout dans l'app. Plusieurs codes
// ISO peuvent partager un symbole (XOF et XAF = « F CFA »).

export interface SupportedCurrency {
  /** Symbole — clé métier utilisée par le moteur (wallets, min. de retrait). */
  symbol: string
  /** Codes ISO regroupés sous ce symbole. */
  codes: string[]
  /** Libellé lisible pour l'admin, ex. « F CFA — Franc CFA (XOF · XAF) ». */
  label: string
}

function buildSupportedCurrencies(): SupportedCurrency[] {
  const bySymbol = new Map<string, { codes: Set<string>; countries: Set<string> }>()
  for (const c of Object.values(COUNTRIES)) {
    const entry = bySymbol.get(c.currencySymbol) ?? { codes: new Set(), countries: new Set() }
    entry.codes.add(c.currency)
    entry.countries.add(c.name)
    bySymbol.set(c.currencySymbol, entry)
  }

  const NAMES: Record<string, string> = {
    NGN: 'Naira', XOF: 'Franc CFA', XAF: 'Franc CFA', GHS: 'Cedi', GNF: 'Franc guinéen',
    GMD: 'Dalasi', SLE: 'Leone', LRD: 'Dollar libérien', CVE: 'Escudo', MRU: 'Ouguiya',
    CDF: 'Franc congolais', EUR: 'Euro', USD: 'Dollar US', CAD: 'Dollar canadien',
  }

  return Array.from(bySymbol.entries()).map(([symbol, { codes }]) => {
    const codeList = Array.from(codes).sort()
    const name = NAMES[codeList[0]] ?? codeList[0]
    return {
      symbol,
      codes: codeList,
      label: `${symbol} — ${name} (${codeList.join(' · ')})`,
    }
  }).sort((a, b) => a.label.localeCompare(b.label))
}

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = buildSupportedCurrencies()

export const SUPPORTED_CURRENCY_SYMBOLS: string[] = SUPPORTED_CURRENCIES.map((c) => c.symbol)

export function isSupportedCurrencySymbol(symbol: string): boolean {
  return SUPPORTED_CURRENCY_SYMBOLS.includes(symbol)
}
