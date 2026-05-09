'use client'

import { useAuthContext } from '@/lib/contexts/auth-context'
import { formatCurrency } from '@/lib/utils/currency'
import { getCountry } from '@/lib/saas/countries'

/**
 * Returns a fmt() function bound to the current shop's currency.
 * Symbol is always derived from the countries config (never the DB snapshot)
 * so any config update is immediately reflected across all shops.
 * Usage: const { fmt, symbol } = useCurrency()
 *        fmt(1500) → "₦1,500" or "1 500 F CFA"
 */
export function useCurrency() {
  const { shop } = useAuthContext()
  // Derive symbol from live config; fall back to stored shop.currency then ₦
  const symbol = shop
    ? getCountry(shop.country).currencySymbol
    : '₦'

  const fmt = (amount: number | string | null | undefined) =>
    formatCurrency(amount, symbol)

  return { fmt, symbol }
}
