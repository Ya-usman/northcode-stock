'use client'

import { useEffect, useRef, useState } from 'react'
import { WifiOff, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useOffline } from '@/lib/offline/use-offline'
import { cn } from '@/lib/utils/cn'
import type { SyncResult } from '@/lib/offline/sync'

export function OfflineBanner() {
  const t = useTranslations('banners.offline')
  const { isOnline, pendingCount, syncing, sync, lastSyncResult } = useOffline()

  const [showResult, setShowResult] = useState(false)
  const [displayedResult, setDisplayedResult] = useState<SyncResult | null>(null)
  const prevResultRef = useRef<SyncResult | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // React to auto-sync AND manual sync results
  useEffect(() => {
    if (!lastSyncResult || lastSyncResult === prevResultRef.current) return
    if (lastSyncResult.synced === 0 && lastSyncResult.failed === 0) return
    prevResultRef.current = lastSyncResult
    setDisplayedResult(lastSyncResult)
    setShowResult(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    // Auto-hide success after 4s; keep error visible until user retries
    if (lastSyncResult.failed === 0) {
      timerRef.current = setTimeout(() => setShowResult(false), 4000)
    }
  }, [lastSyncResult])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const handleSync = async () => {
    setShowResult(false)
    await sync()
    // result comes through lastSyncResult effect above
  }

  // Nothing to show
  if (isOnline && pendingCount === 0 && !showResult) return null

  // Show sync result (success or error) — triggered by auto-sync or manual sync
  if (showResult && displayedResult) {
    const allOk = displayedResult.failed === 0
    return (
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 text-xs font-medium border-b',
        allOk
          ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
          : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400'
      )}>
        {allOk
          ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
          : <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
        }
        <span className="flex-1">
          {allOk
            ? t('synced_success', { count: displayedResult.synced })
            : t('sync_error', { count: displayedResult.failed, detail: displayedResult.errors[0] ?? t('check_connection') })
          }
        </span>
        {!allOk && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 px-2.5 py-1 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
            {t('retry')}
          </button>
        )}
      </div>
    )
  }

  // Show pending/offline state
  return (
    <div className={cn(
      'flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium border-b',
      !isOnline
        ? 'bg-red-500/10 border-red-500/20 text-red-500 dark:text-red-400'
        : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
    )}>
      <div className="flex items-center gap-2">
        <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
        {!isOnline
          ? pendingCount > 0
            ? t('offline_pending', { count: pendingCount })
            : t('offline_saved_locally')
          : t('pending_sync', { count: pendingCount })
        }
      </div>
      {isOnline && pendingCount > 0 && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 px-2.5 py-1 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
          {syncing ? t('syncing') : t('sync_button')}
        </button>
      )}
    </div>
  )
}
