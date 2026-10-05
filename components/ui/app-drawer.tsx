'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { PremiumHeader } from '@/components/ui/premium-header'
import { UnsavedChangesDialog, useCloseGuard } from '@/components/ui/unsaved-changes'

// ── AppDrawer ────────────────────────────────────────────────────────────────
// Panneau latéral droit (420 à 720 px) sur ordinateur, plein écran ou feuille
// basse sur téléphone. En-tête premium compact, corps seul défilant, pied fixe,
// Échap, piège de focus (Radix), garde « modifications non enregistrées ».
// Le clic sur le voile ne ferme pas (comme les modales existantes) : un clic
// sur un toast ou un menu ne doit jamais faire perdre une saisie.

export type DrawerWidth = 'sm' | 'md' | 'lg' | 'xl'

const WIDTHS: Record<DrawerWidth, string> = {
  sm: 'sm:max-w-[420px]',
  md: 'sm:max-w-[520px]',
  lg: 'sm:max-w-[640px]',
  xl: 'sm:max-w-[720px]',
}

export interface AppDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Étiquette en capitales au-dessus du titre (module, contexte) */
  category?: string
  title: string
  description?: string
  icon?: React.ReactNode
  width?: DrawerWidth
  /** Saisie en cours non enregistrée : la fermeture demande confirmation */
  dirty?: boolean
  /** Pied fixe ; en fonction pour accéder à `requestClose` (bouton Annuler) */
  footer?: React.ReactNode | ((ctx: { requestClose: () => void }) => React.ReactNode)
  children: React.ReactNode
  bodyClassName?: string
  /** Téléphone : panneau plein écran (défaut) ou feuille basse */
  mobile?: 'fullscreen' | 'sheet'
  /** Attribut data-testid posé sur le panneau */
  testId?: string
}

const FIELD_SELECTOR = 'input:not([type=hidden]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled]), [data-autofocus]'

export function AppDrawer({
  open, onOpenChange, category, title, description, icon, width = 'md', dirty = false,
  footer, children, bodyClassName, mobile = 'fullscreen', testId,
}: AppDrawerProps) {
  const tActions = useTranslations('actions')
  const contentRef = React.useRef<HTMLDivElement>(null)
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange])
  const guard = useCloseGuard({ open, dirty, onClose: close })

  // Ordinateur : focus sur le premier champ. Téléphone : focus sur le panneau
  // lui-même, pour ne pas faire surgir le clavier à l'ouverture. Un contenu
  // chargé à la demande (formulaire produit) pose lui-même son autoFocus.
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
    <DialogPrimitive.Root open={open} onOpenChange={v => { if (v) onOpenChange(true); else guard.requestClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          ref={contentRef}
          data-testid={testId}
          data-drawer={mobile}
          className={cn(
            'fixed z-50 flex w-full flex-col bg-background shadow-2xl outline-none',
            // Ordinateur : panneau collé à droite, pleine hauteur
            'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:border-l sm:border-border',
            WIDTHS[width],
            // Téléphone : plein écran ou feuille basse
            mobile === 'sheet'
              ? 'max-sm:inset-x-0 max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[92dvh] max-sm:rounded-t-2xl'
              : 'max-sm:inset-0 max-sm:h-[100dvh]',
            'duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out',
            'max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom',
            'sm:data-[state=open]:slide-in-from-right sm:data-[state=closed]:slide-out-to-right',
          )}
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          onOpenAutoFocus={handleAutoFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>}
          <PremiumHeader
            category={category}
            title={title}
            description={description}
            icon={icon}
            onClose={guard.requestClose}
            closeLabel={tActions('close')}
            // Téléphone plein écran : 20 px au-dessus du titre, plus la zone
            // sûre de l'appareil (encoche, barre d'état) s'il en a une
            className={cn(
              mobile === 'fullscreen' && 'max-sm:pt-[calc(1.25rem_+_env(safe-area-inset-top,0px))] max-sm:pb-5 max-sm:[&>button]:top-[calc(1.25rem_+_env(safe-area-inset-top,0px))]',
              mobile === 'sheet' && 'max-sm:rounded-t-2xl',
            )}
          />
          {/* Corps gris doux : les sections (DrawerSection) sont des cartes blanches */}
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/40 px-4 py-4 dark:bg-muted/20', bodyClassName)}>
            {children}
          </div>
          {footer && (
            // Marge sous les boutons : 20 px sur téléphone (plus la zone sûre
            // de l'appareil s'il en a une), 16 px sur ordinateur
            <div className="flex-shrink-0 border-t border-border bg-background px-5 pt-4 pb-[calc(1.25rem_+_env(safe-area-inset-bottom,0px))] sm:pb-4">
              {typeof footer === 'function' ? footer({ requestClose: guard.requestClose }) : footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <UnsavedChangesDialog open={guard.confirming} onKeepEditing={guard.keepEditing} onDiscard={guard.discard} />
    </DialogPrimitive.Root>
  )
}

// ── DrawerSection ────────────────────────────────────────────────────────────
// Section de panneau = carte blanche : bandeau de titre, contenu ; repliable
// si demandé (barre d'accent bleue, sous-titre, chevron). Le contenu replié
// reste monté (champs enregistrés, valeurs conservées), il est seulement masqué.

export interface DrawerSectionProps {
  title?: string
  description?: string
  collapsible?: boolean
  /** État initial d'une section repliable (fermée par défaut pour les options avancées) */
  defaultOpen?: boolean
  /** Contrôle externe de l'ouverture (ex. : ouvrir si une erreur s'y trouve) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

export function DrawerSection({
  title, description, collapsible = false, defaultOpen = true, open: openProp, onOpenChange, children, className,
}: DrawerSectionProps) {
  const [openState, setOpenState] = React.useState(defaultOpen)
  const isOpen = !collapsible || (openProp ?? openState)
  const toggle = () => {
    const next = !isOpen
    setOpenState(next)
    onOpenChange?.(next)
  }
  return (
    <section className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      {title && (
        collapsible ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={toggle}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 h-5 w-[3px] flex-shrink-0 rounded-full bg-stockshop-blue dark:bg-blue-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{title}</span>
                {description && <span className="block text-xs text-muted-foreground">{description}</span>}
              </span>
            </span>
            <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </button>
        ) : (
          <div className="border-b border-border bg-muted/30 px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        )
      )}
      <div className={cn('space-y-4 px-4 py-4', collapsible && title && 'border-t border-border', !isOpen && 'hidden')}>
        {children}
      </div>
    </section>
  )
}
