'use client'

import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Affiché à la place du skeleton de chargement quand useShopLoadTimeout
// détecte que effectiveShopIds ne s'est jamais rempli — jamais un
// chargement infini silencieux, toujours une sortie possible pour
// l'utilisateur.
export function LoadErrorFallback() {
  const t = useTranslations()
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-12 text-center px-4">
      <AlertTriangle className="h-8 w-8 text-amber-500" />
      <p className="text-sm text-muted-foreground max-w-xs">{t('errors.load_timeout')}</p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        {t('actions.retry')}
      </Button>
    </div>
  )
}
