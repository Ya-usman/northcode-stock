'use client'

// Carte « Activer les notifications » (29 oct. 2026). Un abonnement ne peut pas être créé sans l'accord de la personne
// (le téléphone crée les clés après « Autoriser ») : on PROPOSE l'activation au bon moment au lieu de la laisser dans
// Paramètres. Montrée seulement :
//   • aux personnes qui ont quelque chose à recevoir (propriétaire, Responsable, Manager, droit « Prolonger ») ;
//   • sur un appareil qui sait recevoir des notifications web (navigateur ; pas l'application Android, dont le
//     composant d'affichage ne les gère pas) et qui n'a encore ni accepté ni refusé ;
//   • jamais en même temps que la fenêtre du téléphone : celle-ci ne s'ouvre qu'après « Activer » (un refus réflexe à
//     l'ouverture serait définitif). « Plus tard » : 30 jours sans la revoir sur cet appareil.
// Appareil déjà autorisé mais pas encore abonné : abonnement fait sans rien demander (aucune fenêtre ne s'ouvre).
// Destinataires triés par droits côté serveur (pushRecipients) : s'abonner ne donne accès à rien de plus.
import { useEffect, useState } from 'react'
import { BellRing, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { getPushPermission, isPushSupported, subscribeToPush } from '@/lib/push'

const SNOOZE_DAYS = 30
const key = (userId: string) => `push_card_later:${userId}`

function snoozed(userId: string): boolean {
  try {
    const until = Number(localStorage.getItem(key(userId)) || 0)
    return until > Date.now()
  } catch { return false }
}

export function EnableNotificationsCard({ userId, shopId, eligible }: { userId: string; shopId: string | null; eligible: boolean }) {
  const t = useTranslations('push_card')
  const { toast } = useToast()
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setShow(false)
    if (!eligible || !shopId || !isPushSupported()) return
    ;(async () => {
      const permission = await getPushPermission()
      if (permission === 'granted') {
        // Déjà autorisé sur cet appareil : abonnement silencieux s'il manque (aucune fenêtre)
        const reg = await navigator.serviceWorker.ready.catch(() => null)
        const existing = reg ? await reg.pushManager.getSubscription().catch(() => null) : null
        if (!existing) await subscribeToPush(shopId).catch(() => false)
        return
      }
      if (permission === 'default' && !snoozed(userId) && !cancelled) setShow(true)
    })()
    return () => { cancelled = true }
  }, [eligible, shopId, userId])

  const later = () => {
    try { localStorage.setItem(key(userId), String(Date.now() + SNOOZE_DAYS * 86_400_000)) } catch { /* stockage indisponible */ }
    setShow(false)
  }

  const enable = async () => {
    if (!shopId) return
    setBusy(true)
    try {
      const ok = await subscribeToPush(shopId)
      if (ok) {
        toast({ title: t('enabled_toast'), variant: 'success' })
        setShow(false)
      } else {
        const permission = await getPushPermission()
        toast({ title: permission === 'denied' ? t('blocked_toast') : t('failed_toast'), variant: 'destructive' })
        if (permission === 'denied') setShow(false)
      }
    } finally {
      setBusy(false)
    }
  }

  if (!show) return null
  return (
    <div className="px-4 pt-4 sm:px-6 sm:pt-6" data-testid="enable-notifications-card">
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/50 dark:text-blue-400" aria-hidden="true">
            <BellRing className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{t('title')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('body')}</p>
          </div>
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button variant="outline" className="h-11 flex-1 sm:h-10 sm:flex-none" onClick={later} disabled={busy} data-testid="enable-notifications-later">
            {t('later')}
          </Button>
          <Button variant="stockshop" className="h-11 flex-[2] sm:h-10 sm:flex-none" onClick={enable} disabled={busy} data-testid="enable-notifications-enable">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('enable')}
          </Button>
        </div>
      </div>
    </div>
  )
}
