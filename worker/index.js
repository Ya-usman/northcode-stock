// Custom service worker code — merged into next-pwa generated sw.js.
//
// Navigate requests (full page loads: link clicks that escape OfflineLink's
// SPA interception, hard reloads, typed URLs) are handled entirely here,
// not by next-pwa's runtimeCaching/fallbacks config. That mechanism was
// traced end-to-end (handlerDidError plugin injection, the generated
// fallback-*.js chunk, /offline precached via precacheAndRoute) and looked
// correctly wired in the built sw.js, yet still served the browser's native
// offline error page instead of /offline in real offline tests. Rather than
// keep guessing why next-pwa's black-box wiring fails, navigation is owned
// explicitly here, in the file we fully control and can reason about.
//
// RSC payloads, static assets, and API/Supabase calls are still handled by
// Workbox via runtimeCaching in next.config.js — only request.mode ===
// 'navigate' is claimed here, so there's no risk of two handlers both
// calling event.respondWith() on the same fetch event.

// Cache /offline during install so it is always available under the exact
// key caches.match('/offline') looks for — both in the Workbox precache
// (additionalManifestEntries in next.config.js) and here in 'next-pages' as
// a second copy, in case the precache ever fails for any reason.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('next-pages')
      .then(cache => cache.add('/offline'))
      .catch(() => {}) // Never let this fail the SW install
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Android cold-start fallback: MainActivity.java loads /__offline_fallback__
  // after a short delay (to let the SW activate). Always serve the cached
  // /offline page here regardless of network, making this a real
  // SW-controlled client so that subsequent navigations (card clicks) are
  // intercepted by the SW normally.
  if (url.pathname === '/__offline_fallback__') {
    event.respondWith(
      caches.match('/offline', { ignoreSearch: true })
        .then(r => r || caches.match('/offline'))
        .catch(() => new Response('<h1>Hors connexion</h1>', {
          headers: { 'Content-Type': 'text/html' }
        }))
    )
    return
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Stale-while-revalidate: refresh the cache in the background so
          // the next offline visit to this exact page has fresh content.
          const copy = response.clone()
          caches.open('next-pages').then(cache => cache.put(event.request, copy)).catch(() => {})
          return response
        })
        .catch(() =>
          caches.match(event.request, { ignoreSearch: true })
            .then(cached => cached || caches.match('/offline', { ignoreSearch: true }))
            .then(res => res || new Response('<h1>Hors connexion</h1>', {
              headers: { 'Content-Type': 'text/html' }
            }))
        )
    )
  }
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

// When the device regains connectivity (even if the app is closed), message
// all open app windows to trigger a data sync.
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
