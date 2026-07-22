'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { RefreshCw, AlertTriangle } from 'lucide-react'

// Mirrors components/pwa/sw-updater.tsx's global chunk-error recovery — this
// boundary is exactly what catches a failed (app)/layout.tsx chunk load (the
// segment's own error.tsx can't catch errors in its own layout, per Next.js;
// they bubble up here), the single most likely real trigger for this file.
// A stale/missing chunk after a deploy shouldn't strand the user on a manual
// "Réessayer" click — reload once automatically, same cooldown guard as
// sw-updater.tsx to avoid a reload loop if the chunk is genuinely still 404ing.
const CHUNK_ERROR_KEY = 'sw_chunk_reload_at'
const CHUNK_ERROR_COOLDOWN_MS = 30_000

function isChunkLoadError(text: string): boolean {
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module/i.test(text)
}

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('error_page')
  const [autoReloading, setAutoReloading] = useState(false)

  useEffect(() => {
    console.error('[App Error]', error)

    if (!isChunkLoadError(`${error?.name || ''} ${error?.message || ''}`)) return
    const lastReload = Number(sessionStorage.getItem(CHUNK_ERROR_KEY) || 0)
    if (Date.now() - lastReload < CHUNK_ERROR_COOLDOWN_MS) return // already tried recently
    sessionStorage.setItem(CHUNK_ERROR_KEY, String(Date.now()))
    setAutoReloading(true)
    window.location.reload()
  }, [error])

  if (autoReloading) return null

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
          <Button onClick={reset} className="gap-2 bg-stockshop-blue">
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
