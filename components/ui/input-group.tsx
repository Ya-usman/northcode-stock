'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

// Champ avec suffixe accolé (devise, unité) ou bouton d'action accolé
// (scanner). L'enfant est le champ lui-même ; ses angles côté suffixe sont
// aplatis ici, le suffixe reprend la bordure du champ.

interface InputGroupProps {
  children: ReactNode
  /** Texte court affiché dans un bloc gris accolé à droite (ex. : FCFA, pièce) */
  suffix?: ReactNode
  /** Bouton accolé à droite (ex. : scanner) ; rendu tel quel, après le suffixe */
  action?: ReactNode
  className?: string
}

export function InputGroup({ children, suffix, action, className }: InputGroupProps) {
  return (
    // Focus : le contour entoure TOUT le bloc (champ + suffixe/bouton). Celui du champ
    // seul débordait de 4 px et passait par-dessus le bouton accolé (ex. : « Scan »).
    <div className={cn(
      'flex w-full items-stretch rounded-md ring-offset-background',
      'has-[>input:focus-visible]:ring-2 has-[>input:focus-visible]:ring-ring has-[>input:focus-visible]:ring-offset-2',
      '[&>input]:min-w-0 [&>input]:flex-1 [&>input]:rounded-r-none [&>input:focus-visible]:ring-0 [&>input:focus-visible]:ring-offset-0',
      className,
    )}>
      {children}
      {suffix != null && suffix !== '' && (
        <span className={cn('inline-flex flex-shrink-0 items-center border border-l-0 border-input bg-muted px-3 text-sm text-muted-foreground', action ? '' : 'rounded-r-md')}>
          {suffix}
        </span>
      )}
      {action}
    </div>
  )
}

/** Astérisque rouge des champs obligatoires */
export const RequiredMark = () => <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>
