import { NextIntlClientProvider } from 'next-intl'
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

export default async function LocaleLayout({ children, params: { locale } }: LocaleLayoutProps) {
  if (!locales.includes(locale as Locale)) notFound()

  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <CapacitorDeepLinkHandler locale={locale} />
      <LocaleSync currentLocale={locale} />
      {children}
      <Toaster />
    </NextIntlClientProvider>
  )
}
