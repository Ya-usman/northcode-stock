'use client'

// Bandeau « demande de prolongation » pour le propriétaire et les personnes qui ont le droit « Prolonger » (décisions du
// 29 oct. 2026) : chaque demande en attente de la boutique active, avec Accepter (prolongation accordée à partir de
// maintenant, l'écran de l'employé se débloque seul) ou Refuser. Relu toutes les 30 s et au retour sur l'onglet ; une
// notification sur le téléphone prévient aussi (route serveur).
import { useCallback, useEffect, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface PendingRequest { id: string; minutes: number; message: string | null; created_at: string; requester_name: string | null }

export function ExtensionRequestsBanner({ shopId, shopName }: { shopId: string; shopName: string }) {
  const t = useTranslations('shop_hours')
  const { toast } = useToast()
  const [pending, setPending] = useState<PendingRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/shops/extension-requests?shop_id=${shopId}`)
      if (!res.ok) return
      const j = await res.json()
      setPending(j.available ? (j.pending || []) : [])
    } catch { /* hors connexion */ }
  }, [shopId])
  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  const decide = async (id: string, approve: boolean) => {
    setBusy(id)
    try {
      const res = await fetch('/api/shops/extension-requests/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, approve }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || res.statusText)
      toast({ title: approve ? t('requests_accepted_toast') : t('requests_refused_toast'), variant: 'success' })
    } catch (e: any) {
      toast({ title: e.message, variant: 'destructive' })
    } finally {
      setBusy(null)
      await load()
    }
  }

  if (!pending.length) return null
  return (
    <div className="space-y-2 border-b bg-stockshop-blue-muted/60 px-4 py-3 dark:bg-blue-950/30" data-testid="extension-requests-banner">
      {pending.map(r => (
        <div key={r.id} className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center" data-testid="extension-request">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400">
              <Clock className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {t('requests_banner_one', { name: r.requester_name || '', duration: t(`duration_${r.minutes}` as any), shop: shopName })}
              </p>
              {r.message && <p className="mt-0.5 truncate text-sm text-muted-foreground">« {r.message} »</p>}
            </div>
          </div>
          <div className="flex gap-2 sm:shrink-0">
            <Button variant="outline" className="h-10 flex-1 sm:flex-none" onClick={() => decide(r.id, false)} disabled={busy === r.id} data-testid="extension-request-refuse">
              {t('requests_refuse')}
            </Button>
            <Button variant="stockshop" className="h-10 flex-1 sm:flex-none" onClick={() => decide(r.id, true)} disabled={busy === r.id} data-testid="extension-request-accept">
              {busy === r.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('requests_accept')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
