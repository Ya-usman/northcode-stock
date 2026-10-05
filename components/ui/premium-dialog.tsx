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
// en-tête blanc partagé avec les panneaux, corps défilant, pied fixe.
// `dirty` active la garde « modifications non enregistrées » à la fermeture.

export interface PremiumDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Étiquette en capitales au-dessus du titre (action, contexte) ; jamais l'onglet courant */
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
  /** Attribut data-testid posé sur la fenêtre */
  testId?: string
  children: React.ReactNode
}

const FIELD_SELECTOR = 'input:not([type=hidden]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled]), [data-autofocus]'

export function PremiumDialog({
  open, onOpenChange, category, title, description, icon, maxWidth = 'max-w-sm', centered, dirty = false, testId, children,
}: PremiumDialogProps) {
  const tActions = useTranslations('actions')
  const contentRef = React.useRef<HTMLDivElement>(null)
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const guard = useCloseGuard({ open, dirty, onClose: close })

  // Le X de l'en-tête est le premier élément focusable : sans cela, le focus
  // initial tomberait dessus. Ordinateur : premier champ ; téléphone : la
  // fenêtre elle-même (pas de clavier qui surgit) ; sans champ : la fenêtre.
  const handleAutoFocus = (e: Event) => {
    const root = contentRef.current
    if (!root) return
    e.preventDefault()
    const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
    const first = desktop ? root.querySelector<HTMLElement>(FIELD_SELECTOR) : null
    if (first) first.focus({ preventScroll: true })
    else root.focus({ preventScroll: true })
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (v) onOpenChange(true); else guard.requestClose() }}>
      <DialogContent
        ref={contentRef}
        data-testid={testId}
        onOpenAutoFocus={handleAutoFocus}
        className={cn(
          'p-0 gap-0 flex flex-col max-h-[90dvh] overflow-hidden rounded-xl',
          // Le X de l'en-tête commun remplace celui de la modale shadcn
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
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <PremiumHeader
            category={category}
            title={title}
            description={description}
            icon={icon}
            onClose={guard.requestClose}
            closeLabel={tActions('close')}
          />
          {/* Body — scrollable, footer stays pinned below */}
          <div className="flex flex-col flex-1 min-h-0 bg-background overflow-hidden">
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
  /** Icône rendue avant le libellé du bouton principal */
  confirmIcon?: React.ReactNode
  /** Render custom buttons instead of the default confirm button */
  children?: React.ReactNode
}

const TONE_CLASSES: Record<ConfirmButtonTone, string> = {
  primary: 'bg-stockshop-blue hover:bg-stockshop-blue-light dark:bg-blue-600 dark:hover:bg-blue-500 text-white',
  danger: 'bg-red-500 hover:bg-red-600 text-white border-0',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white border-0',
}

/** Pied commun (modales et panneaux) : UNE rangée, aussi sur téléphone —
 *  Annuler sur un tiers, bouton principal sur le reste ; largeurs naturelles
 *  alignées à droite sur ordinateur. */
export const FOOTER_ROW_CLASS = 'flex flex-wrap items-center gap-3 sm:justify-end'
export const FOOTER_CANCEL_CLASS = 'h-11 w-[calc(33.333%-0.5rem)] rounded-lg px-4 font-medium sm:w-auto sm:min-w-[110px]'
export const FOOTER_PRIMARY_CLASS = 'h-11 min-w-0 flex-1 rounded-lg px-5 font-semibold gap-2 sm:flex-none sm:min-w-[140px]'

export function PremiumDialogFooter({
  onCancel, cancelLabel,
  onConfirm, confirmLabel,
  confirmDisabled, confirmLoading, confirmDestructive, confirmTone, confirmIcon,
  children,
}: PremiumDialogFooterProps) {
  const t = useTranslations('actions')
  cancelLabel = cancelLabel ?? t('cancel')
  confirmLabel = confirmLabel ?? t('confirm')
  const tone: ConfirmButtonTone = confirmTone ?? (confirmDestructive ? 'danger' : 'primary')
  return (
    <div className={cn('flex-shrink-0 border-t border-border bg-background px-5 py-4', FOOTER_ROW_CLASS)}>
      <Button
        type="button"
        variant="outline"
        className={FOOTER_CANCEL_CLASS}
        onClick={onCancel}
        disabled={confirmLoading}
      >
        {cancelLabel}
      </Button>
      {children}
      {onConfirm && (
        <Button
          type="button"
          className={cn(FOOTER_PRIMARY_CLASS, TONE_CLASSES[tone])}
          disabled={confirmDisabled}
          loading={confirmLoading}
          onClick={onConfirm}
          data-tone={tone}
        >
          {!confirmLoading && confirmIcon}
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
