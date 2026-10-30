'use client'

import type { ReactNode } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// En-tête commun des modales et des panneaux latéraux StockShop : bleu de la
// marque (uni, sans décor), icône dans une pastille translucide, titre blanc,
// sous-titre bleu clair, X blanc. L'étiquette (category) n'apparaît que si
// elle apporte une information que le titre ne porte pas (action au-dessus
// d'un nom d'objet), jamais l'onglet courant. Mode sombre : bleu nuit.
//
// Flèche retour ou croix (validé le 30 oct. 2026) : une flèche ← en haut à gauche quand on est ENTRÉ dans un écran
// (panneau plein écran sur téléphone, panneau ouvert par-dessus un autre), une croix ✕ quand la couche est POSÉE
// par-dessus la page (fenêtre au centre, panneau latéral simple sur ordinateur).

export interface PremiumHeaderProps {
  /** Petite étiquette en capitales au-dessus du titre (action, contexte) */
  category?: string
  title: string
  description?: string
  icon?: ReactNode
  /** Rendu du bouton X */
  onClose?: () => void
  closeLabel?: string
  /** Croix : partout (défaut) ou seulement sur ordinateur (le téléphone a la flèche retour) */
  closeOn?: 'all' | 'desktop'
  /** Flèche retour à gauche du titre */
  onBack?: () => void
  backLabel?: string
  /** Flèche retour : partout (défaut) ou seulement sur téléphone */
  backOn?: 'all' | 'mobile'
  className?: string
}

export function PremiumHeader({ category, title, description, icon, onClose, closeLabel = 'Fermer', closeOn = 'all', onBack, backLabel = 'Retour', backOn = 'all', className }: PremiumHeaderProps) {
  return (
    <div className={cn('relative flex-shrink-0 bg-stockshop-blue px-5 py-4 text-white dark:bg-blue-950',
      onClose ? (closeOn === 'desktop' ? 'sm:pr-14' : 'pr-14') : '',
      onBack && (backOn === 'mobile' ? 'max-sm:pl-3' : 'pl-3'), className)}>
      {category && (
        <p className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wider text-blue-200', onBack && (backOn === 'mobile' ? 'max-sm:pl-12' : 'pl-12'))}>{category}</p>
      )}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            data-testid="header-back"
            className={cn('-my-1 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
              backOn === 'mobile' && 'sm:hidden')}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        {icon && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/15 text-white [&>svg]:h-5 [&>svg]:w-5">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-white">{title}</p>
          {description && <p className="mt-0.5 text-sm text-blue-100/90">{description}</p>}
        </div>
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          data-testid="header-close"
          className={cn('absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white',
            closeOn === 'desktop' && 'max-sm:hidden')}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
