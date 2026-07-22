import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { locales, type Locale } from '@/i18n'
import { Toaster } from '@/components/ui/toaster'
import { LocaleSync } from '@/components/locale-sync'
import { CapacitorDeepLinkHandler } from '@/components/capacitor-deep-link-handler'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: { locale: string }
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }))
}

// Only the landing page and (auth) pages (login/register/reset-password) render
// directly under this root layout — the (app) and (admin) route groups provide
// their own NextIntlClientProvider with the full catalog. Scoping this one down
// keeps the public/marketing pages from shipping every feature's translations.
// error_page is included even though no page here renders it directly:
// app/[locale]/error.tsx (this segment's own error boundary) is exactly what
// catches a failed (app)/layout.tsx chunk load — the one time the full-catalog
// provider from (app)/layout.tsx is guaranteed NOT to have mounted — so it can
// only ever render with whatever this outer provider supplies.
const PUBLIC_NAMESPACES = ['landing', 'auth', 'register', 'error_page'] as const

export default async function LocaleLayout({ children, params: { locale } }: LocaleLayoutProps) {
  if (!locales.includes(locale as Locale)) notFound()

  const messages = await getMessages()
  const publicMessages = Object.fromEntries(
    PUBLIC_NAMESPACES.map(ns => [ns, (messages as Record<string, unknown>)[ns]])
  ) as AbstractIntlMessages

  return (
    <NextIntlClientProvider locale={locale} messages={publicMessages}>
      <CapacitorDeepLinkHandler locale={locale} />
      <LocaleSync currentLocale={locale} />
      {children}
      <Toaster />
    </NextIntlClientProvider>
  )
}
