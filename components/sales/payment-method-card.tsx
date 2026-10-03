'use client'

import { memo } from 'react'
import { Banknote, Check, CreditCard, Landmark, Smartphone, User, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { PaymentMethod, PaymentMethodType } from '@/lib/saas/countries'

// Pictogramme par TYPE de moyen (pas par nom) : un nouveau moyen « cash »
// d'un autre pays hérite automatiquement du bon dessin.
const ICONS: Record<PaymentMethodType, LucideIcon> = {
  cash: Banknote,
  mobile_money: Smartphone,
  transfer: Landmark,
  card: CreditCard,
  credit: User,
}

interface PaymentMethodCardProps {
  method: PaymentMethod
  selected: boolean
  /** Sous-titre explicatif (« Paiement en espèces », « Compte client »…). */
  subtitle: string
  onSelect: (id: string) => void
}

// Carte d'un moyen de paiement (Nouvelle vente, étape paiement — grille
// principale et 2e moyen du paiement mixte). Logo réel quand il existe (MTN,
// Orange Money, Wave…), sinon un pictogramme dans un carré bleu clair — plus
// d'émojis, dont le rendu change d'un téléphone à l'autre.
function PaymentMethodCardImpl({ method, selected, subtitle, onSelect }: PaymentMethodCardProps) {
  const Icon = ICONS[method.type] ?? Banknote
  return (
    <button
      type="button"
      onClick={() => onSelect(method.id)}
      aria-pressed={selected}
      className={cn(
        'relative flex flex-col items-center gap-2 rounded-2xl border-2 px-2 py-3 text-center transition-all duration-200 active:scale-95 tap-target',
        selected
          ? 'border-stockshop-blue bg-stockshop-blue-muted/70 shadow-sm dark:border-blue-500 dark:bg-blue-950/50'
          : 'border-input bg-card hover:border-stockshop-blue/40 hover:shadow-md dark:hover:border-blue-700',
      )}
    >
      {selected && (
        <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-stockshop-blue text-white dark:bg-blue-600" aria-hidden="true">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}
      <span
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-xl',
          // Les logos (PNG/JPG à fond blanc) gardent une tuile blanche dans les deux thèmes
          method.logo ? 'bg-white shadow-sm' : 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/60 dark:text-blue-300',
        )}
        aria-hidden="true"
      >
        {method.logo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={method.logo} alt="" className="h-11 w-11 object-contain" />
          : <Icon className="h-7 w-7" />}
      </span>
      <span className="min-w-0">
        <span className={cn('block text-xs font-semibold leading-tight', selected ? 'text-stockshop-blue dark:text-blue-400' : 'text-foreground')}>
          {method.label}
        </span>
        <span className="block text-[10px] leading-tight text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}

export const PaymentMethodCard = memo(PaymentMethodCardImpl)
