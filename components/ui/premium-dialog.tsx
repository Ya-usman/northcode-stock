'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PremiumHeader } from '@/components/ui/premium-header'
import { UnsavedChangesDialog, useCloseGuard } from '@/components/ui/unsaved-changes'
import { cn } from '@/lib/utils/cn'

// ── PremiumDialog (AppModal) ─────────────────────────────────────────────────
// Modale centrée pour les actions courtes (≤ 6-7 champs) et les confirmations :
// en-tête premium compact partagé avec les panneaux, corps défilant, pied fixe.
// `dirty` active la garde « modifications non enregistrées » à la fermeture.

export interface PremiumDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Small uppercase label shown above the title in the blue header */
  category?: string
  title: string
  /** Sous-titre affiché sous le titre (aussi lu par les lecteurs d'écran) */
  description?: string
  /** Optional icon rendered left of the title */
  icon?: React.ReactNode
  /** Tailwind max-width class, e.g. 'max-w-sm' (default) or 'max-w-md' */
  maxWidth?: string
  /** Center dialog vertically on mobile (use for dialogs without form inputs) */
  centered?: boolean
  /** Saisie en cours non enregistrée : la fermeture demande confirmation */
  dirty?: boolean
  children: React.ReactNode
}

export function PremiumDialog({
  open, onOpenChange, category, title, description, icon, maxWidth = 'max-w-sm', centered, dirty = false, children,
}: PremiumDialogProps) {
  const tActions = useTranslations('actions')
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const guard = useCloseGuard({ open, dirty, onClose: close })
  return (
    <Dialog open={open} onOpenChange={v => { if (v) onOpenChange(true); else guard.requestClose() }}>
      <DialogContent
        className={cn(
          'p-0 gap-0 flex flex-col max-h-[90dvh] overflow-hidden',
          // Le X de l'en-tête premium remplace celui de la modale shadcn
          '[&>button]:hidden',
          centered && 'max-sm:!top-1/2 max-sm:!-translate-y-1/2',
          maxWidth
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        {...(description ? {} : { 'aria-describedby': undefined })}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {description && <DialogDescription className="sr-only">{description}</DialogDescription>}
        <div className="flex flex-col flex-1 min-h-0 rounded-lg overflow-hidden">
          <PremiumHeader
            category={category}
            title={title}
            description={description}
            icon={icon}
            onClose={guard.requestClose}
            closeLabel={tActions('close')}
            className="rounded-t-lg"
          />
          {/* Body — scrollable, footer stays pinned below */}
          <div className="flex flex-col flex-1 min-h-0 bg-background rounded-b-lg overflow-hidden">
            {children}
          </div>
        </div>
      </DialogContent>
      <UnsavedChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} />
    </Dialog>
  )
}

// ── PremiumDialogBody ────────────────────────────────────────────────────────
interface PremiumDialogBodyProps {
  children: React.ReactNode
  className?: string
}

export function PremiumDialogBody({ children, className }: PremiumDialogBodyProps) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-5 space-y-4', className)}>
      {children}
    </div>
  )
}

// ── PremiumDialogFooter ──────────────────────────────────────────────────────
export type ConfirmButtonTone = 'primary' | 'danger' | 'warning'

interface PremiumDialogFooterProps {
  onCancel: () => void
  cancelLabel?: string
  onConfirm?: () => void
  confirmLabel?: string
  confirmDisabled?: boolean
  confirmLoading?: boolean
  /** Red destructive style for delete/cancel actions (alias de confirmTone="danger") */
  confirmDestructive?: boolean
  /** Couleur du bouton principal : bleu (défaut), rouge (suppression), ambre (avertissement) */
  confirmTone?: ConfirmButtonTone
  /** Render custom buttons instead of the default confirm button */
  children?: React.ReactNode
}

const TONE_CLASSES: Record<ConfirmButtonTone, string> = {
  primary: 'bg-stockshop-blue hover:bg-stockshop-blue-light dark:bg-blue-600 dark:hover:bg-blue-500 text-white',
  danger: 'bg-red-500 hover:bg-red-600 text-white border-0',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white border-0',
}

export function PremiumDialogFooter({
  onCancel, cancelLabel,
  onConfirm, confirmLabel,
  confirmDisabled, confirmLoading, confirmDestructive, confirmTone,
  children,
}: PremiumDialogFooterProps) {
  const t = useTranslations('actions')
  cancelLabel = cancelLabel ?? t('cancel')
  confirmLabel = confirmLabel ?? t('confirm')
  const tone: ConfirmButtonTone = confirmTone ?? (confirmDestructive ? 'danger' : 'primary')
  return (
    <div className="flex-shrink-0 px-5 pb-5 pt-3 flex justify-center gap-3 border-t border-border bg-background">
      <Button
        type="button"
        variant="ghost"
        className="flex-1 h-11 rounded-xl text-foreground/70 hover:text-foreground hover:bg-foreground/8 border border-border"
        onClick={onCancel}
        disabled={confirmLoading}
      >
        {cancelLabel}
      </Button>
      {children}
      {onConfirm && (
        <Button
          type="button"
          className={cn('flex-1 h-11 rounded-xl font-semibold', TONE_CLASSES[tone])}
          disabled={confirmDisabled}
          loading={confirmLoading}
          onClick={onConfirm}
          data-tone={tone}
        >
          {confirmLabel}
        </Button>
      )}
    </div>
  )
}

// Alias « harmonisation UX » : mêmes composants, nom générique
export const AppModal = PremiumDialog
export const AppModalBody = PremiumDialogBody
export const AppModalFooter = PremiumDialogFooter
