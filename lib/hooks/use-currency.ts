'use client'

import { useAuthContext } from '@/lib/contexts/auth-context'
import { formatCurrency } from '@/lib/utils/currency'

/**
 * Returns a fmt() function bound to the current shop's currency.
 * Usage: const { fmt, symbol } = useCurrency()
 *        fmt(1500) → "₦1,500" or "1 500 FCFA"
 */
export function useCurrency() {
  const { shop } = useAuthContext()
  const symbol = shop?.currency || '₦'

  const fmt = (amount: number | string | null | undefined) =>
    formatCurrency(amount, symbol)

  return { fmt, symbol }
}
