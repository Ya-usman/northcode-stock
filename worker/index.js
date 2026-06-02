// Custom service worker code — merged into next-pwa generated sw.js

// ── RSC navigation caching ────────────────────────────────────────────────────
// Next.js App Router client-side navigation appends a unique `_rsc` nonce to
// every fetch. Workbox can't match cached entries because the key changes each
// time. This listener intercepts those requests first, strips the nonce from
// the cache key, and falls back to the cached payload when offline.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const isRsc =
    event.request.headers.get('RSC') === '1' ||
    url.searchParams.has('_rsc')

  if (!isRsc) return // let workbox handle everything else

  const cacheKey = new URL(url)
  cacheKey.searchParams.delete('_rsc')

  event.respondWith(
    caches.open('next-rsc-nav').then(async (cache) => {
      try {
        const response = await Promise.race([
          fetch(event.request),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('sw-timeout')), 5000)
          ),
        ])
        if (response && (response.ok || response.status === 200)) {
          cache.put(cacheKey.toString(), response.clone())
        }
        return response
      } catch {
        const cached = await cache.match(cacheKey.toString())
        if (cached) return cached
        // RSC requests expect RSC data, NOT HTML — returning HTML crashes Next.js.
        // Return a network error so Next.js ErrorBoundary handles it in-app
        // instead of the browser showing its own "no internet" page.
        return Response.error()
      }
    })
  )
})

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const title = data.title || 'StockShop'
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    tag: data.tag || 'stockshop',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(targetUrl)
          return
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl)
    })
  )
})

// ── Background Sync ───────────────────────────────────────────────────────────
// When the device regains connectivity (even if the app is closed), the browser
// fires this event. We message all open app windows to trigger a sync.
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-sales') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          client.postMessage({ type: 'BACKGROUND_SYNC_SALES' })
        }
      })
    )
  }
})
