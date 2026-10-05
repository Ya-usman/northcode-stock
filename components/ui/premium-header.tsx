'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// En-tête commun des modales et des panneaux latéraux StockShop : fond blanc,
// icône dans une pastille bleu clair, titre, sous-titre gris, X à droite.
// L'étiquette (category) n'apparaît que si elle apporte une information que
// le titre ne porte pas (action au-dessus d'un nom d'objet), jamais l'onglet.

export interface PremiumHeaderProps {
  /** Petite étiquette en capitales au-dessus du titre (action, contexte) */
  category?: string
  title: string
  description?: string
  icon?: ReactNode
  /** Rendu du bouton X */
  onClose?: () => void
  closeLabel?: string
  className?: string
}

export function PremiumHeader({ category, title, description, icon, onClose, closeLabel = 'Fermer', className }: PremiumHeaderProps) {
  return (
    <div className={cn('relative flex-shrink-0 border-b border-border bg-background px-5 py-4 pr-14', className)}>
      {category && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-stockshop-blue dark:text-blue-400">{category}</p>
      )}
      <div className="flex items-center gap-3">
        {icon && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400 [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-foreground">{title}</p>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
