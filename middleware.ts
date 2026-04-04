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
  '/team':            ['owner'],
  '/reports':         ['owner'],
  '/settings':        ['owner'],
  '/stock':           ['owner', 'stock_manager'],
  '/stock/movements': ['owner', 'stock_manager'],
  '/suppliers':       ['owner', 'stock_manager'],
  '/sales/new':       ['owner', 'cashier'],
  '/sales/history':   ['owner', 'cashier'],
  '/payments':        ['owner'],
  '/customers':       ['owner', 'cashier'],
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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const pathnameWithoutLocale = pathname.replace(/^\/(en|ha)/, '') || '/'
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
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Page publique (landing, login, register...)
  if (isPublic(pathnameWithoutLocale)) {
    // Si déjà connecté et va vers login/register → dashboard
    if (user && (pathnameWithoutLocale === '/login' || pathnameWithoutLocale === '/register')) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
    }
    const intlRes = intlMiddleware(request)
    return intlRes || response
  }

  // Page protégée sans session → login
  if (!user) {
    const loginUrl = new URL(`/${locale}/login`, request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Vérification du rôle (avec cache cookie)
  const requiredRoles = getRequiredRoles(pathnameWithoutLocale)
  if (requiredRoles) {
    let role = request.cookies.get('user_role')?.value

    if (!role) {
      const { data } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single()

      const profile = data as { role: string; is_active: boolean } | null
      role = profile?.role

      if (profile && !profile.is_active) {
        return NextResponse.redirect(new URL(`/${locale}/login?error=inactive`, request.url))
      }
      if (role) {
        response.cookies.set('user_role', role, {
          maxAge: 3600,
          httpOnly: false,
          path: '/',
          sameSite: 'lax',
        })
      }
    }

    if (role && !requiredRoles.includes(role)) {
      return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
    }
  }

  const intlResponse = intlMiddleware(request)
  if (intlResponse) return intlResponse

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icons|.*\\.png|.*\\.jpg|.*\\.svg).*)'],
}
