'use client'

import { Loader2, UploadCloud, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import type { SyncResult } from '@/lib/offline/sync'

interface Props {
  pendingCount: number
  syncing: boolean
  onSync: () => Promise<SyncResult | null>
}

export function SyncBanner({ pendingCount, syncing, onSync }: Props) {
  const [lastResult, setLastResult] = useState<SyncResult | null>(null)
  const [showResult, setShowResult] = useState(false)

  if (pendingCount === 0 && !showResult) return null

  const handleSync = async () => {
    setShowResult(false)
    const result = await onSync()
    if (result) {
      setLastResult(result)
      setShowResult(true)
      if (result.failed === 0) {
        setTimeout(() => setShowResult(false), 4000)
      }
    }
  }

  if (showResult && lastResult) {
    const allOk = lastResult.failed === 0
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 mb-3 rounded-lg text-xs ${
        allOk
          ? 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 text-green-700 dark:text-green-400'
          : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400'
      }`}>
        {allOk
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          : <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        }
        <span>
          {allOk
            ? `${lastResult.synced} vente${lastResult.synced > 1 ? 's' : ''} synchronisée${lastResult.synced > 1 ? 's' : ''} ✓`
            : `${lastResult.synced} synchronisée${lastResult.synced > 1 ? 's' : ''}, ${lastResult.failed} échouée${lastResult.failed > 1 ? 's' : ''}`
          }
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 text-xs text-blue-700 dark:text-blue-400">
      <UploadCloud className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        {pendingCount} vente{pendingCount > 1 ? 's' : ''} en attente de synchronisation
      </span>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        onClick={handleSync}
        disabled={syncing}
      >
        {syncing
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : 'Synchroniser'
        }
      </Button>
    </div>
  )
}
