'use client'

import { useAuthContext } from '@/lib/contexts/auth-context'
import { formatCurrency } from '@/lib/utils/currency'
import { resolveCurrencyCode, currencySymbol } from '@/lib/saas/currencies'

/**
 * Devise de la boutique active, normalisée en CODE ISO.
 *
 * `shop.currency` peut encore contenir un SYMBOLE (dette V3, migration en
 * cours) — `resolveCurrencyCode` le normalise, avec le pays de la boutique
 * comme départage pour « F CFA » (XAF vs XOF) et repli final NGN.
 *
 * Usage :
 *   const { fmt, code, symbol } = useCurrency()
 *   fmt(1500)  → "₦1,500" | "1 500 F CFA" | "1 500 €"
 *   code       → "NGN" | "XAF" | "XOF" | …   (pour la logique métier)
 *   symbol     → "₦" | "F CFA" | …            (affichage brut si besoin)
 */
export function useCurrency() {
  const { shop } = useAuthContext()
  const code = resolveCurrencyCode(shop?.currency, shop?.country)
  const symbol = currencySymbol(code)

  const fmt = (amount: number | string | null | undefined) => formatCurrency(amount, code)

  return { fmt, code, symbol }
}
