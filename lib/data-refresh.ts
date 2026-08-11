// Lightweight pub-sub for "sales data changed, please refetch" — used by
// dashboard and sales/history, whose own fetch functions (loadDashboard,
// fetchSales) already have their own independent instant-render caching.
//
// Deliberately NOT react-query: routing these two pages through useQuery
// meant every query in the app — including reports, which genuinely needs
// react-query's cache — had to wait for PersistQueryClientProvider's async
// cache restoration before any query could even start fetching. That
// regressed the instant, synchronous cache reads these two pages already
// had. They only ever needed a "refetch now" signal, not a cache, so they
// use this instead.
type Listener = () => void
const listeners = new Set<Listener>()

export function onSalesDataChanged(fn: Listener): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function notifySalesDataChanged(): void {
  listeners.forEach(fn => fn())
}
