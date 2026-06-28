// Custom service worker code — merged into next-pwa generated sw.js
// ONLY push notifications and background sync are handled here.
// Navigate and RSC requests are handled entirely by Workbox (NetworkFirst)
// with the self.fallback (ignoreSearch:true) catching failures — this is
// the only correct way to serve /offline from the Workbox precache.

// Cache /offline during install so it is always available under the exact
// key that caches.match('/offline') looks for — both with the new SW
// (self.fallback uses ignoreSearch:true → finds Workbox precache entry) and
// as an insurance entry in 'next-pages' if the precache failed for any reason.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('next-pages')
      .then(cache => cache.add('/offline'))
      .catch(() => {}) // Never let this fail the SW install
  )
})

// Android cold-start fallback: MainActivity.java loads /__offline_fallback__
// after a short delay (to let the SW activate). The SW responds with the
// cached /offline page, making this a real SW-controlled client so that
// subsequent navigations (card clicks) are intercepted by the SW normally.
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname === '/__offline_fallback__') {
    event.respondWith(
      caches.match('/offline', { ignoreSearch: true })
        .then(r => r || caches.match('/offline'))
        .catch(() => new Response('<h1>Hors connexion</h1>', {
          headers: { 'Content-Type': 'text/html' }
        }))
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
