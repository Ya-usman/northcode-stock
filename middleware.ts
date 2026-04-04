import createMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { locales, defaultLocale } from './i18n'

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password']

// Role access map
const ROLE_ACCESS: Record<string, string[]> = {
  '/team':             ['owner'],
  '/reports':          ['owner'],
  '/settings':         ['owner'],
  '/stock':            ['owner', 'stock_manager'],
  '/stock/movements':  ['owner', 'stock_manager'],
  '/suppliers':        ['owner', 'stock_manager'],
  '/sales/new':        ['owner', 'cashier'],
  '/sales/history':    ['owner', 'cashier'],
  '/payments':         ['owner'],
  '/customers':        ['owner', 'cashier'],
}

function getRequiredRoles(path: string): string[] | null {
  // exact or prefix match
  for (const [route, roles] of Object.entries(ROLE_ACCESS)) {
    if (path === route || path.startsWith(route + '/')) return roles
  }
  return null // public or dashboard — all roles allowed
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const pathnameWithoutLocale = pathname.replace(/^\/(en|ha)/, '') || '/'
  const locale = pathname.split('/')[1] || defaultLocale

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
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  // Single auth check
  const { data: { user } } = await supabase.auth.getUser()

  // Root redirect
  if (pathname === '/') {
    return NextResponse.redirect(new URL(`/${locale}/${user ? 'dashboard' : 'login'}`, request.url))
  }

  // Redirect authenticated users away from login
  if (PUBLIC_PATHS.includes(pathnameWithoutLocale) && user) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
  }

  // Redirect unauthenticated users to login
  if (!PUBLIC_PATHS.includes(pathnameWithoutLocale) && !user) {
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
  }

  // Role check — only if route has restrictions
  if (user) {
    const requiredRoles = getRequiredRoles(pathnameWithoutLocale)
    if (requiredRoles) {
      // Read role from cookie (set at login) or fetch once
      let role = request.cookies.get('user_role')?.value

      if (!role) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, is_active')
          .eq('id', user.id)
          .single()

        role = profile?.role
        if (profile && !profile.is_active) {
          return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
        }
        // Cache role in cookie for 1 hour
        if (role) {
          response.cookies.set('user_role', role, { maxAge: 3600, httpOnly: false, path: '/' })
        }
      }

      if (role && !requiredRoles.includes(role)) {
        return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url))
      }
    }
  }

  const intlResponse = intlMiddleware(request)
  if (intlResponse) return intlResponse

  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|sw.js|workbox-.*|icons|.*\\.png|.*\\.jpg|.*\\.svg).*)',
  ],
}
