'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Input } from '@/components/ui/input'

// ── ConfirmModal ─────────────────────────────────────────────────────────────
// Confirmation courte : question, conséquences, bouton distinct (rouge pour
// une suppression, ambre pour un avertissement), chargement anti-double-clic,
// saisie de confirmation facultative pour les actions irréversibles.

export type ConfirmTone = 'danger' | 'warning' | 'primary'

export interface ConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category?: string
  title: string
  description?: React.ReactNode
  icon?: React.ReactNode
  /** Contenu complémentaire (récapitulatif, avertissement…) sous la description */
  children?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  loading?: boolean
  disabled?: boolean
  onConfirm: () => void
  /** Texte exact à recopier avant de pouvoir confirmer (ex. : nom du produit) */
  requireText?: string
  maxWidth?: string
}

export function ConfirmModal({
  open, onOpenChange, category, title, description, icon, children,
  confirmLabel, cancelLabel, tone = 'primary', loading = false, disabled = false, onConfirm, requireText, maxWidth,
}: ConfirmModalProps) {
  const t = useTranslations('dialogs')
  const [typed, setTyped] = React.useState('')
  React.useEffect(() => { if (!open) setTyped('') }, [open])
  // Comparaison insensible à la casse (comportement des anciennes confirmations)
  const typedOk = !requireText || typed.trim().toLowerCase() === requireText.trim().toLowerCase()

  return (
    <PremiumDialog
      open={open}
      onOpenChange={onOpenChange}
      category={category}
      title={title}
      icon={icon}
      maxWidth={maxWidth ?? 'max-w-sm'}
      centered={!requireText}
    >
      <PremiumDialogBody>
        {description && <div className="text-sm text-foreground/80">{description}</div>}
        {children}
        {requireText && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t('confirm_type_hint', { text: requireText })}</p>
            <Input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={requireText}
              autoComplete="off"
              data-testid="confirm-type-input"
            />
          </div>
        )}
      </PremiumDialogBody>
      <PremiumDialogFooter
        onCancel={() => onOpenChange(false)}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        confirmLabel={confirmLabel}
        confirmTone={tone}
        confirmDisabled={disabled || !typedOk}
        confirmLoading={loading}
      />
    </PremiumDialog>
  )
}
