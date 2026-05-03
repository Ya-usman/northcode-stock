/**
 * Format a number as Nigerian Naira (legacy — use formatCurrency when possible)
 */
export function formatNaira(amount: number | string | null | undefined): string {
  return formatCurrency(amount, '₦')
}

/**
 * Format a monetary amount with the shop's currency symbol.
 * symbol: '₦' for Nigeria, 'FCFA' for Cameroon
 */
export function formatCurrency(amount: number | string | null | undefined, symbol: string): string {
  const num = Number(amount ?? 0)
  const isFCFA = symbol === 'FCFA'
  const formatted = num.toLocaleString(isFCFA ? 'fr-FR' : 'en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
  return isFCFA ? `${formatted} FCFA` : `₦${formatted}`
}

/**
 * Format compact (e.g. ₦1.2M, ₦45K / 1,2M FCFA)
 */
export function formatNairaCompact(amount: number, symbol = '₦'): string {
  if (amount >= 1_000_000) {
    const v = (amount / 1_000_000).toFixed(1)
    return symbol === 'FCFA' ? `${v}M FCFA` : `₦${v}M`
  }
  if (amount >= 1_000) {
    const v = (amount / 1_000).toFixed(1)
    return symbol === 'FCFA' ? `${v}K FCFA` : `₦${v}K`
  }
  return formatCurrency(amount, symbol)
}

/**
 * Parse Naira string back to number
 */
export function parseNaira(value: string): number {
  return parseFloat(value.replace(/[₦,\s]/g, '')) || 0
}

/**
 * Format a raw digit string for display in a price input (with thousand separators, no symbol).
 * Strips any non-digit characters first so it's safe to pass either raw or partially-formatted strings.
 */
export function formatInputValue(rawDigits: string | number, currency: string): string {
  const digits = String(rawDigits ?? '').replace(/\D/g, '')
  if (!digits) return ''
  const num = parseInt(digits, 10)
  if (isNaN(num)) return ''
  return num.toLocaleString(currency === 'FCFA' ? 'fr-FR' : 'en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/**
 * Calculate profit margin percentage
 */
export function profitMargin(buyingPrice: number, sellingPrice: number): number {
  if (sellingPrice === 0) return 0
  return ((sellingPrice - buyingPrice) / sellingPrice) * 100
}

/**
 * Calculate profit amount
 */
export function profitAmount(buyingPrice: number, sellingPrice: number): number {
  return sellingPrice - buyingPrice
}
