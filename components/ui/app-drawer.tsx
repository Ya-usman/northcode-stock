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
            className={cn(mobile === 'fullscreen' && 'max-sm:safe-top', mobile === 'sheet' && 'max-sm:rounded-t-2xl')}
          />
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4', bodyClassName)}>
            {children}
          </div>
          {footer && (
            <div className="flex-shrink-0 border-t border-border bg-background px-5 py-3 safe-bottom">
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
// Section de panneau : titre, description, contenu ; repliable si demandé.
// Le contenu replié reste monté (champs de formulaire enregistrés, valeurs
// conservées), il est seulement masqué.

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
    <section className={cn('border-t border-border pt-4 first:border-t-0 first:pt-0', className)}>
      {title && (
        collapsible ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={toggle}
            className="-mx-1 flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">{title}</span>
              {description && <span className="block text-xs text-muted-foreground">{description}</span>}
            </span>
            <ChevronDown className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </button>
        ) : (
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
        )
      )}
      <div className={cn('space-y-4', collapsible && title && 'mt-3', !isOpen && 'hidden')}>
        {children}
      </div>
    </section>
  )
}
