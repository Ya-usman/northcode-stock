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
const PUBLIC_NAMESPACES = ['landing', 'auth', 'register'] as const

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
