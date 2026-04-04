/**
 * Format a number as Nigerian Naira
 */
export function formatNaira(amount: number | string | null | undefined): string {
  const num = Number(amount ?? 0)
  return `₦${num.toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

/**
 * Format compact (e.g. ₦1.2M, ₦45K)
 */
export function formatNairaCompact(amount: number): string {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`
  if (amount >= 1_000) return `₦${(amount / 1_000).toFixed(1)}K`
  return formatNaira(amount)
}

/**
 * Parse Naira string back to number
 */
export function parseNaira(value: string): number {
  return parseFloat(value.replace(/[₦,\s]/g, '')) || 0
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
