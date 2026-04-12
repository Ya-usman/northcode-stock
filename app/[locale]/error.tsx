'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { RefreshCw, AlertTriangle } from 'lucide-react'

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('error_page')

  useEffect(() => {
    console.error('[App Error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center max-w-sm">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-red-100 mb-4">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">{t('title')}</h1>
        <p className="text-sm text-muted-foreground mb-2">{t('body')}</p>
        <p className="text-xs font-mono bg-gray-100 rounded p-2 mb-4 text-left break-all text-red-600">
          {error?.message || String(error)}
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={reset} className="gap-2 bg-northcode-blue">
            <RefreshCw className="h-4 w-4" />
            {t('try_again')}
          </Button>
          <Button variant="outline" onClick={() => window.location.href = '/'}>
            {t('go_home')}
          </Button>
        </div>
      </div>
    </div>
  )
}
