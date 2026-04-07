import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { locales, defaultLocale } from './i18n'

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

// Pages accessibles sans connexion
const PUBLIC_PATHS = ['/', '/login', '/register', '/forgot-password', '/reset-password']

// Restrictions par rôle
const ROLE_ACCESS: Record<string, string[]> = {
  '/team':              ['owner'],
  '/reports':           ['owner'],
  '/settings':          ['owner'],
  '/billing':           ['owner'],
  '/admin':             ['owner'],
  '/shops':             ['owner'],
  '/stock':             ['owner', 'stock_manager'],
  '/stock/movements':   ['owner', 'stock_manager'],
  '/stock/transfers':   ['owner', 'stock_manager'],
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

  const { data: { user } } = await supabase.auth.getUser()

  // Root → dashboard or login
  if (pathname === '/') {
    const dest = user ? `/${locale}/dashboard` : `/${locale}/login`
    return mergeAuthCookies(NextResponse.redirect(new URL(dest, request.url)), response)
  }

  // Page publique (landing, login, register...)
  if (isPublic(pathnameWithoutLocale)) {
    if (user && (pathnameWithoutLocale === '/login' || pathnameWithoutLocale === '/register')) {
      return mergeAuthCookies(NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url)), response)
    }
    const intlRes = intlMiddleware(request)
    return mergeAuthCookies(intlRes || response, response)
  }

  // Page protégée sans session → login
  if (!user) {
    const loginUrl = new URL(`/${locale}/login`, request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return mergeAuthCookies(NextResponse.redirect(loginUrl), response)
  }

  // Always verify is_active + role from DB (cookie used only as fast-path for role)
  const { data: profileData } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  const profile = profileData as { role: string; is_active: boolean } | null

  // Deactivated account → force logout
  if (profile && !profile.is_active) {
    // Clear role cookie
    const loginUrl = new URL(`/${locale}/login?error=inactive`, request.url)
    const redirectRes = NextResponse.redirect(loginUrl)
    redirectRes.cookies.set('user_role', '', { maxAge: 0, path: '/' })
    return mergeAuthCookies(redirectRes, response)
  }

  // Cache role in cookie for 30 minutes
  const role = profile?.role
  if (role) {
    response.cookies.set('user_role', role, {
      maxAge: 1800,
      httpOnly: false,
      path: '/',
      sameSite: 'lax',
    })
  }

  // Role-based access control
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
