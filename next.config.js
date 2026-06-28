const createNextIntlPlugin = require('next-intl/plugin')
const withNextIntl = createNextIntlPlugin('./i18n.ts')

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // Exclude EVERYTHING from the Workbox precache (radical fix).
  //
  // WHY: Workbox's addAll() is all-or-nothing — if ANY single file fails
  // (CDN hiccup, 404, timeout), the entire SW install is aborted silently.
  // The old SW stays in control forever. No controllerchange. No reload.
  // With hundreds of files (JS chunks, CSS, fonts, images, JSON manifests),
  // even one transient error is enough to block users from ever getting
  // the new SW.
  //
  // SAFE because runtimeCaching already covers everything:
  //   • /_next/static/.* → CacheFirst (JS, CSS, fonts, images)
  //   • navigate requests  → NetworkFirst (pages + /offline fallback)
  //   • RSC payloads       → StaleWhileRevalidate
  // Files are cached on first use instead of at install time.
  // After one online session the app works fully offline — identical UX.
  // SW installation is now instantaneous (precache list is empty).
  buildExcludes: [/.*/],
  publicExcludes: ['**/*'],
  // Précache /offline explicitement — setCatchHandler en a besoin pour servir
  // la page offline quand un réseau + cache échouent en même temps.
  // buildExcludes vide tout le reste, mais additionalManifestEntries est manuel.
  additionalManifestEntries: [{ url: '/offline', revision: 'v3' }],
  runtimeCaching: [
    // RSC payloads (client-side navigation) — StaleWhileRevalidate.
    // matchOptions.ignoreSearch: true est critique — Next.js ajoute un param
    // ?_rsc=<id> dynamique à chaque requête RSC. Sans ignoreSearch, le cache
    // ne trouve jamais les entrées du prefetch (stockées sans ce param) et
    // tombe en cache miss → réseau échoue → navigation dure → onReceivedError.
    {
      urlPattern: ({ request, url }) =>
        request.headers.get('RSC') === '1' ||
        url.searchParams.has('_rsc'),
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'next-rsc',
        expiration: { maxEntries: 120, maxAgeSeconds: 24 * 60 * 60 },
        matchOptions: { ignoreSearch: true },
      },
    },
    // Page HTML (navigation complète) — NetworkFirst :
    // Essaie le réseau (timeout 5s), puis le cache, puis la page /offline.
    // 5s au lieu de 1s : couvre les cold starts Vercel (3-8s) sans tomber
    // prématurément sur le cache. Quand le cache est chaud (sessions suivantes),
    // le réseau répond en < 500ms de toute façon — pas de pénalité perceptible.
    {
      urlPattern: ({ request }) => request.mode === 'navigate',
      handler: 'NetworkFirst',
      options: {
        cacheName: 'next-pages',
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // Internal API routes (health, push, etc.)
    {
      urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
      handler: 'NetworkFirst',
      options: {
        cacheName: 'api-routes',
        expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
        networkTimeoutSeconds: 3,
      },
    },
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'supabase-api',
        expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
        networkTimeoutSeconds: 5,
      },
    },
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'supabase-storage',
        expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    {
      urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'static-images',
        expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
      },
    },
  ],
  fallbacks: {
    document: '/offline',
  },
})

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=self, microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
]

const isDev = process.env.NODE_ENV === 'development'

const csp = [
  "default-src 'self'",
  // unsafe-eval: dev only (Next.js HMR). Removed in production.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.paystack.co`,
  // Styles : app + inline (Next.js / Tailwind)
  "style-src 'self' 'unsafe-inline'",
  // Images : app + Supabase Storage + data URIs
  "img-src 'self' data: blob: https://*.supabase.co",
  // Fonts
  "font-src 'self' data:",
  // Connexions réseau autorisées
  [
    "connect-src 'self'",
    "https://*.supabase.co",
    "wss://*.supabase.co",
    "https://api.paystack.co",
    "https://api.flutterwave.com",
    "https://api.notchpay.co",
    "https://*.upstash.io",
  ].join(' '),
  // Iframes : uniquement Paystack checkout
  "frame-src 'self' https://checkout.paystack.com https://checkout.flutterwave.com",
  // Interdit de charger cette page dans une iframe externe
  "frame-ancestors 'self'",
  // Workers (service worker PWA)
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

const nextConfig = {
  compress: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          ...securityHeaders,
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion', '@zxing/browser', '@zxing/library'],
    instrumentationHook: true,
  },
}

module.exports = withPWA(withNextIntl(nextConfig))
