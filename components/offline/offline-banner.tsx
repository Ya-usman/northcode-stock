'use client'

import { WifiOff, RefreshCw } from 'lucide-react'
import { useOffline } from '@/lib/offline/use-offline'
import { useToast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils/cn'

export function OfflineBanner() {
  const { isOnline, pendingCount, syncing, sync } = useOffline()
  const { toast } = useToast()

  const handleSync = async () => {
    const result = await sync()
    if (!result) return
    if (result.synced > 0) {
      toast({
        title: `${result.synced} vente${result.synced > 1 ? 's' : ''} synchronisée${result.synced > 1 ? 's' : ''}`,
        variant: 'success',
      })
    }
    if (result.failed > 0) {
      toast({
        title: `${result.failed} vente${result.failed > 1 ? 's' : ''} en erreur`,
        description: 'Vérifiez votre connexion et réessayez.',
        variant: 'destructive',
      })
    }
  }

  // Nothing to show
  if (isOnline && pendingCount === 0) return null

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-4 py-2 text-xs font-medium border-b',
        !isOnline
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-amber-50 border-amber-200 text-amber-700'
      )}
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
        {!isOnline
          ? 'Mode hors-ligne · ventes sauvegardées localement'
          : `${pendingCount} vente${pendingCount > 1 ? 's' : ''} en attente de synchronisation`}
      </div>

      {isOnline && pendingCount > 0 && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-md bg-amber-100 hover:bg-amber-200 px-2.5 py-1 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
          {syncing ? 'Sync…' : 'Synchroniser'}
        </button>
      )}
    </div>
  )
}
