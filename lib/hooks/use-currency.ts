'use client'

import { useAuthContext } from '@/lib/contexts/auth-context'
import { formatCurrency } from '@/lib/utils/currency'
import { getCountry } from '@/lib/saas/countries'

/**
 * Returns a fmt() function bound to the current shop's currency.
 * shop.currency (set in settings) is the source of truth.
 * Falls back to the country config symbol, then ₦.
 * Usage: const { fmt, symbol } = useCurrency()
 *        fmt(1500) → "₦1,500" or "1 500 F CFA"
 */
export function useCurrency() {
  const { shop } = useAuthContext()
  const symbol = shop?.currency || getCountry(shop?.country).currencySymbol || '₦'

  const fmt = (amount: number | string | null | undefined) =>
    formatCurrency(amount, symbol)

  return { fmt, symbol }
}
