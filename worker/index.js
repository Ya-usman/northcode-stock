// Custom service worker code — merged into next-pwa generated sw.js

// ── Pre-cache /offline at install so it's always available as fallback ────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('next-pages').then(cache => cache.add('/offline'))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ── Navigate requests (full page loads / hard navigation) ─────────────────────
// We own this handler entirely — Workbox NetworkFirst is too slow on Android.
// Strategy: try network (2s timeout), fall back to cache, fall back to /offline.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    (async () => {
      const cache = await caches.open('next-pages')
      const url = new URL(event.request.url)

      // Helper: try to match with or without query params
      const matchCache = () =>
        cache.match(event.request.url) ||
        cache.match(url.origin + url.pathname)

      try {
        const response = await Promise.race([
          fetch(event.request),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('nav-timeout')), 2000)
          ),
        ])
        if (response && response.ok) {
          cache.put(url.origin + url.pathname, response.clone())
        }
        return response
      } catch {
        const cached = await matchCache()
        if (cached) return cached
        const offline = await caches.match('/offline') ||
                        await cache.match('/offline')
        return offline || new Response('Offline', { status: 503 })
      }
    })()
  )
})

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

        // No RSC cache — try to serve the HTML version so Workbox can handle
        // the navigate fallback properly (avoids browser "no internet" page).
        const htmlCache = await caches.open('next-pages')
        const htmlFallback = await htmlCache.match(cacheKey.toString())
        if (htmlFallback) return htmlFallback

        // Return a 503 so Next.js ErrorBoundary catches it in-app.
        // NEVER return Response.error() — it's opaque and triggers Chrome's
        // own "web page not available" error page instead of our UI.
        return new Response('Offline — page not cached', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
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
