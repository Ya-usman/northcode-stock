'use client'

import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { queryClient } from '@/lib/query-client'

// Persists the react-query cache to localStorage so migrated pages keep the
// same "render instantly from cache, refresh in the background" behavior the
// app already has everywhere else (lib/offline/page-cache.ts) — without this,
// react-query's cache is in-memory only and a hard reload would show a blank
// skeleton instead of last-known data while offline/slow.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [persister] = useState(() =>
    typeof window !== 'undefined'
      ? createSyncStoragePersister({ storage: window.localStorage, key: 'rq_cache_v1' })
      : null
  )

  if (!persister) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        // Scoped to the pages actually migrated to react-query — avoids
        // persisting anything unexpected as more pages move over later
        // without an explicit decision to include them.
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            ['dashboard', 'sales-history', 'reports'].includes(query.queryKey[0] as string),
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}
