import { cn } from '@/lib/utils/cn'

// Logo de la boutique, partout de la même façon : boîte carrée, fond blanc,
// bordure fine, logo CONTENU et centré (jamais étiré ni rogné — un logo
// large reste large) ; initiales de la boutique en secours.
const SIZES = {
  sm: 'h-8 w-8 rounded-md p-0.5 text-xs',
  md: 'h-14 w-14 rounded-xl p-1 text-lg',
  lg: 'h-16 w-16 rounded-xl p-1.5 text-xl',
} as const

export function shopInitials(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'SS'
}

// Largeur libre (shape « auto ») : la boîte garde la hauteur et s'élargit
// jusqu'à 3× pour un nom de marque en toutes lettres — là où la place existe
// (aperçu des réglages, en-tête du reçu). Carrée ailleurs (listes, en-têtes serrés).
const AUTO_WIDTH = { sm: 'w-auto min-w-8 max-w-24', md: 'w-auto min-w-14 max-w-[10.5rem]', lg: 'w-auto min-w-16 max-w-48' } as const

export function ShopLogo({ src, name, size = 'md', shape = 'square', className }: {
  src?: string | null
  name?: string | null
  size?: keyof typeof SIZES
  shape?: 'square' | 'auto'
  className?: string
}) {
  if (src) {
    return (
      <div className={cn('flex flex-shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-white dark:border-slate-700', SIZES[size], shape === 'auto' && AUTO_WIDTH[size], className)}>
        <img src={src} alt={name || ''} className={cn('h-full object-contain', shape === 'auto' ? 'w-auto max-w-full' : 'w-full')} />
      </div>
    )
  }
  return (
    <div className={cn('flex flex-shrink-0 items-center justify-center bg-stockshop-blue font-bold text-white', SIZES[size], className)}>
      {shopInitials(name)}
    </div>
  )
}
