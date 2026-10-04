'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// Panneau latéral (bord droit) sur Radix Dialog, pour les détails, journaux
// et fiches : on y met ce qui alourdirait un tableau. Pleine largeur sur
// téléphone, largeur fixe au-delà. Même base d'accessibilité que les boîtes
// de dialogue (focus, Échap, lecteur d'écran).

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close

interface SheetContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  title: string
  description?: string
  icon?: React.ReactNode
  /** Libellé du bouton de fermeture pour les lecteurs d'écran */
  closeLabel?: string
  /** Largeur au-delà du téléphone, ex. sm:max-w-xl */
  width?: string
}

const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  ({ title, description, icon, closeLabel = 'Fermer', width = 'sm:max-w-lg', className, children, ...props }, ref) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl duration-300',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
          width,
          className,
        )}
        {...props}
      >
        <div className="flex items-start gap-3 border-b px-5 py-4 pr-14">
          {icon && (
            <span className="mt-0.5 shrink-0 rounded-lg bg-stockshop-blue-muted p-2 text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold leading-tight">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={description ? 'mt-0.5 text-xs text-muted-foreground' : 'sr-only'}>
              {description || title}
            </DialogPrimitive.Description>
          </div>
        </div>
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="h-4 w-4" />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  ),
)
SheetContent.displayName = 'SheetContent'

export { Sheet, SheetTrigger, SheetClose, SheetContent }
