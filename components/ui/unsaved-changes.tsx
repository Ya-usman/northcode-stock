'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PremiumHeader } from '@/components/ui/premium-header'

// Garde « modifications non enregistrées » partagée par les modales et les
// panneaux : la fermeture (X, Échap, Annuler) passe par `requestClose`, qui
// ferme directement si rien n'a changé, sinon ouvre une petite confirmation.

interface UseCloseGuardOptions {
  open: boolean
  dirty: boolean
  onClose: () => void
}

export function useCloseGuard({ open, dirty, onClose }: UseCloseGuardOptions) {
  const [confirming, setConfirming] = useState(false)

  // Si l'hôte se ferme (succès d'enregistrement…), la confirmation disparaît aussi
  useEffect(() => { if (!open) setConfirming(false) }, [open])

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])
  const discard = useCallback(() => { setConfirming(false); onClose() }, [onClose])
  const keepEditing = useCallback(() => setConfirming(false), [])

  return { requestClose, confirming, discard, keepEditing }
}

interface UnsavedChangesDialogProps {
  open: boolean
  onKeepEditing: () => void
  onDiscard: () => void
}

export function UnsavedChangesDialog({ open, onKeepEditing, onDiscard }: UnsavedChangesDialogProps) {
  const t = useTranslations('dialogs')
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onKeepEditing() }}>
      <DialogContent
        className="max-w-sm p-0 gap-0 overflow-hidden max-sm:!top-1/2 max-sm:!-translate-y-1/2 [&>button]:hidden"
        onPointerDownOutside={e => e.preventDefault()}
        onInteractOutside={e => e.preventDefault()}
        data-testid="unsaved-changes-dialog"
      >
        <DialogTitle className="sr-only">{t('unsaved_title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('unsaved_body')}</DialogDescription>
        <PremiumHeader icon={<AlertTriangle className="h-4 w-4" />} title={t('unsaved_title')} description={t('unsaved_body')} />
        <div className="flex flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-xl border border-border text-foreground/80 hover:text-foreground"
            onClick={onKeepEditing}
          >
            {t('unsaved_continue')}
          </Button>
          <Button
            type="button"
            className="h-11 rounded-xl border-0 bg-red-500 font-semibold text-white hover:bg-red-600"
            onClick={onDiscard}
          >
            {t('unsaved_discard')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
