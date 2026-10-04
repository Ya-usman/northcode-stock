'use client'

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AppDrawer, type AppDrawerProps } from '@/components/ui/app-drawer'

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
  cancelLabel?: string
  /** Action secondaire rendue entre Annuler et le bouton principal */
  secondaryAction?: React.ReactNode
  /** Erreur globale (serveur, réseau…) affichée dans le pied */
  error?: string | null
}

export function FormDrawer({
  formId, onSubmit, submitting = false, submitLabel, submittingLabel, submitDisabled = false,
  cancelLabel, secondaryAction, error, children, ...drawer
}: FormDrawerProps) {
  const tActions = useTranslations('actions')
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
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              className="h-11 rounded-xl border border-border text-foreground/70 hover:text-foreground"
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
              className="h-11 rounded-xl font-semibold sm:min-w-[150px]"
              onClick={formId ? undefined : onSubmit}
              disabled={submitDisabled || submitting}
              loading={submitting}
              data-testid="drawer-submit"
            >
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
