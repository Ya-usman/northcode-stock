import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { locales, defaultLocale } from './i18n'

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

// Période d'accès gratuit bêta : 13 avril → 13 juillet 2026
const BETA_END = new Date('2026-07-13T00:00:00Z')
function isBetaPeriod() {
  const now = new Date()
  return now >= new Date('2026-04-11T00:00:00Z') && now < BETA_END
}

// Pages accessibles sans connexion
const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password', '/update-password']

// Restrictions par rôle
const ROLE_ACCESS: Record<string, string[]> = {
  '/team':              ['owner'],
  '/reports':           ['owner'],
  '/settings':          ['owner'],
  '/billing':           ['owner'],
  '/admin':             ['owner'],
  '/shops':             ['owner'],
  '/stock':             ['owner', 'stock_manager'],
  '/suppliers':         ['owner', 'stock_manager'],
  '/sales/new':         ['owner', 'cashier'],
  '/sales/history':     ['owner', 'cashier'],
  '/payments':          ['owner'],
  '/customers':         ['owner', 'cashier'],
}

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '?'))
}

function getRequiredRoles(path: string): string[] | null {
  for (const [route, roles] of Object.entries(ROLE_ACCESS)) {
    if (path === route || path.startsWith(route + '/')) return roles
  }
  return null
}

// Copy Supabase auth cookies into any response so token refreshes are never lost
function mergeAuthCookies(target: NextResponse, source: NextResponse): NextResponse {
  source.cookies.getAll().forEach(cookie => {
    target.cookies.set(cookie.name, cookie.value, {
      path: cookie.path,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite as 'lax' | 'strict' | 'none' | undefined,
      secure: cookie.secure,
      maxAge: cookie.maxAge,
      expires: cookie.expires,
    })
  })
  return target
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const pathnameWithoutLocale = pathname.replace(/^\/(en|fr|ha)/, '') || '/'
  const locale = pathname.split('/')[1] || defaultLocale

  // Always allow static assets and API
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request: { headers: request.headers } })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Use getSession() — reads cookies locally, NO network call to Supabase.
  // This avoids middleware timeouts on free-tier Supabase/Vercel where getUser()
  // (which makes a DB round-trip) can exceed the Edge Function timeout and return
  // user:null, causing a spurious redirect to /login (= white page).
  // Token integrity is verified server-side in individual API routes that need it.
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id ?? null

  // Root → dashboard or login (respect user's preferred locale cookie)
  if (pathname === '/') {
    const preferredLocale = request.cookies.get('NEXT_LOCALE')?.value
    const resolvedLocale = preferredLocale && locales.includes(preferredLocale as any) ? preferredLocale : locale
    const dest = userId ? `/${resolvedLocale}/dashboard` : `/${resolvedLocale}/login`
    return mergeAuthCookies(NextResponse.redirect(new URL(dest, request.url)), response)
  }

  // Page publique (landing, login, register...)
  if (isPublic(pathnameWithoutLocale)) {
    if (userId && (pathnameWithoutLocale === '/login' || pathnameWithoutLocale === '/register')) {
      return mergeAuthCookies(NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url)), response)
    }
    const intlRes = intlMiddleware(request)
    return mergeAuthCookies(intlRes || response, response)
  }

  // Pendant la période bêta, /billing est redirigé vers le dashboard
  if (isBetaPeriod() && pathnameWithoutLocale === '/billing') {
    return mergeAuthCookies(NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url)), response)
  }

  // Page protégée sans session → login
  if (!userId) {
    const loginUrl = new URL(`/${locale}/login`, request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return mergeAuthCookies(NextResponse.redirect(loginUrl), response)
  }

  // Role from cookie (set at login and on switchShop) — no DB call needed here.
  // Auth-context + API routes handle deeper permission checks.
  const role = request.cookies.get('user_role')?.value

  // Role-based access control (cookie fast-path)
  const requiredRoles = getRequiredRoles(pathnameWithoutLocale)
  if (requiredRoles && role && !requiredRoles.includes(role)) {
    return mergeAuthCookies(NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url)), response)
  }

  // Always merge auth cookies into the final intl response
  const intlResponse = intlMiddleware(request)
  return mergeAuthCookies(intlResponse || response, response)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icons|.*\\.png|.*\\.jpg|.*\\.svg).*)'],
}
