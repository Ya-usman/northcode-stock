import type { QueryClient } from '@tanstack/react-query'

// Central key namespaces for the pages migrated to react-query. Keeping the
// literal prefixes here (rather than inline in each page) is what lets
// invalidateSalesData() below invalidate every one of them from a single
// call site, without each mutation site needing to know the exact shape of
// every page's key (shopKey, filters, etc.) — mirrors how
// clearPageCacheByPrefix('sales_history_v2_') worked for the old cache, but
// covers all three views instead of just one.
export const queryKeys = {
  dashboard:     (shopKey: string) => ['dashboard', shopKey] as const,
  salesHistory:  (shopKey: string, filters: string) => ['sales-history', shopKey, filters] as const,
  reports:       (shopKey: string, filters: string) => ['reports', shopKey, filters] as const,
}

/**
 * Call after any write that changes sales data: a new sale (online or
 * synced from the offline queue), a cancellation, a payment/repayment.
 * Invalidates dashboard/history/reports regardless of which shop or filter
 * combination is cached — any of them currently mounted refetches
 * immediately, and any visited later is marked stale so it fetches fresh
 * instead of serving whatever was last cached.
 */
export function invalidateSalesData(client: QueryClient): void {
  client.invalidateQueries({ queryKey: ['dashboard'] })
  client.invalidateQueries({ queryKey: ['sales-history'] })
  client.invalidateQueries({ queryKey: ['reports'] })
}
