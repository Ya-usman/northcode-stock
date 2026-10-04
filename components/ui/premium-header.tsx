'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// En-tête commun des modales et des panneaux latéraux StockShop : dégradé
// bleu de la marque, étiquette en capitales + icône, titre, sous-titre
// facultatif. Version compacte (pas de cercles décoratifs) pour rester
// légère dans un panneau de pleine hauteur comme dans une petite modale.

export interface PremiumHeaderProps {
  /** Petite étiquette en capitales au-dessus du titre (module, contexte) */
  category?: string
  title: string
  description?: string
  icon?: ReactNode
  /** Rendu du bouton X (les modales shadcn ont déjà le leur) */
  onClose?: () => void
  closeLabel?: string
  className?: string
}

const IconBubble = ({ children }: { children: ReactNode }) => (
  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/15 text-white">
    {children}
  </span>
)

export function PremiumHeader({ category, title, description, icon, onClose, closeLabel = 'Fermer', className }: PremiumHeaderProps) {
  return (
    <div
      className={cn('relative flex-shrink-0 px-5 py-4 pr-14 text-white', className)}
      style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
    >
      {category ? (
        <>
          <div className="mb-1.5 flex items-center gap-2">
            {icon && <IconBubble>{icon}</IconBubble>}
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-200">{category}</span>
          </div>
          <p className="text-lg font-bold leading-tight">{title}</p>
        </>
      ) : (
        // Sans étiquette : l'icône prend place sur la ligne du titre, pas de
        // rangée vide au-dessus (l'onglet courant n'est pas répété ici).
        <div className="flex items-center gap-2.5">
          {icon && <IconBubble>{icon}</IconBubble>}
          <p className="min-w-0 text-lg font-bold leading-tight">{title}</p>
        </div>
      )}
      {description && <p className="mt-1 text-sm text-blue-100/90">{description}</p>}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
