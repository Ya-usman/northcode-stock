import { QueryClient } from '@tanstack/react-query'

// Single browser-wide instance — imported both by the React provider (below)
// and by plain-TS modules that need to invalidate the cache after a write
// that happens outside of a component (e.g. lib/offline/sync.ts, which runs
// from a background-sync/service-worker trigger, not a hook).
//
// staleTime: 60s — data is considered fresh for a minute after a fetch, so
// switching between pages doesn't refire a network request every time. It's
// still invalidated immediately (see lib/query-keys.ts) the moment a sale
// or other mutation actually changes it, regardless of this window.
// gcTime: 24h — matches the spirit of the existing pc_* localStorage cache
// (lib/offline/page-cache.ts), which this replaces for the pages migrated
// to react-query: keep showing the last known data for a long time so the
// app renders instantly offline, and let the persister below survive reloads.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: false, // handled per-page already via visibilitychange; avoid double-fetching
      retry: 1,
    },
  },
})
