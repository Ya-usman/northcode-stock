import type { QueryClient } from '@tanstack/react-query'
import { notifySalesDataChanged } from './data-refresh'

// Only reports actually uses react-query for its data (dashboard and
// sales/history use the lightweight pub-sub in lib/data-refresh.ts instead —
// see the comment there for why).
export const queryKeys = {
  reports: (shopKey: string, filters: string) => ['reports', shopKey, filters] as const,
}

/**
 * Call after any write that changes sales data: a new sale (online or
 * synced from the offline queue), a cancellation, a payment/repayment.
 * Invalidates reports' react-query cache regardless of which shop or filter
 * combination is cached, and notifies dashboard/sales-history via the
 * pub-sub — any of them currently mounted refetches immediately, and any
 * visited later fetches fresh instead of serving whatever was last cached.
 */
export function invalidateSalesData(client: QueryClient): void {
  client.invalidateQueries({ queryKey: ['reports'] })
  notifySalesDataChanged()
}
