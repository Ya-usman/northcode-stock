'use client'

import * as React from 'react'
import { AlertCircle, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AppDrawer, type AppDrawerProps } from '@/components/ui/app-drawer'
import { FOOTER_CANCEL_CLASS, FOOTER_PRIMARY_CLASS } from '@/components/ui/premium-dialog'

// ── FormDrawer ───────────────────────────────────────────────────────────────
// Panneau de formulaire : pied fixe Annuler / Enregistrer avec chargement et
// anti-double-clic, erreur globale au-dessus des boutons, garde de fermeture.
// Avec `formId`, le bouton principal soumet le <form id=…> rendu dans le corps
// (Entrée dans un champ déclenche donc la même soumission).

export interface FormDrawerProps extends Omit<AppDrawerProps, 'footer'> {
  /** id du <form> rendu dans le corps ; le bouton principal le soumet */
  formId?: string
  /** Sinon : action du bouton principal */
  onSubmit?: () => void
  submitting?: boolean
  submitLabel?: string
  submittingLabel?: string
  submitDisabled?: boolean
  /** Icône du bouton principal (disquette par défaut) */
  submitIcon?: React.ReactNode
  cancelLabel?: string
  /** Action secondaire rendue entre Annuler et le bouton principal */
  secondaryAction?: React.ReactNode
  /** Erreur globale (serveur, réseau…) affichée dans le pied */
  error?: string | null
}

export function FormDrawer({
  formId, onSubmit, submitting = false, submitLabel, submittingLabel, submitDisabled = false, submitIcon,
  cancelLabel, secondaryAction, error, children, ...drawer
}: FormDrawerProps) {
  const tActions = useTranslations('actions')
  const icon = submitIcon === undefined ? <Save className="h-4 w-4" /> : submitIcon
  return (
    <AppDrawer
      {...drawer}
      footer={({ requestClose }) => (
        <div className="space-y-3">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <Button
              type="button"
              variant="outline"
              className={FOOTER_CANCEL_CLASS}
              onClick={requestClose}
              disabled={submitting}
            >
              {cancelLabel ?? tActions('cancel')}
            </Button>
            {secondaryAction}
            <Button
              type={formId ? 'submit' : 'button'}
              form={formId}
              variant="stockshop"
              className={FOOTER_PRIMARY_CLASS}
              onClick={formId ? undefined : onSubmit}
              disabled={submitDisabled || submitting}
              loading={submitting}
              data-testid="drawer-submit"
            >
              {!submitting && icon}
              {submitting ? (submittingLabel ?? tActions('saving')) : (submitLabel ?? tActions('save'))}
            </Button>
          </div>
        </div>
      )}
    >
      {children}
    </AppDrawer>
  )
}
