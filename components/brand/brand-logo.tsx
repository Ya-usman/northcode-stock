import { cn } from '@/lib/utils/cn'

// Marque StockShop : le cercle « S » + le nom « StockShop » écrit en texte
// (jamais tout en majuscules), police de marque Montserrat 700 — alternative
// libre la plus proche de Gilroy, police du logo. Espacement resserré
// (-0,04 em) : ramène la largeur du mot à celle du Gilroy des visuels.
//
// Tout se dimensionne avec la taille de police du conteneur : passer une
// classe text-* (ex. « text-xl md:text-2xl ») suffit, responsive compris.

/** Classes du nom « StockShop » quand il est écrit seul dans un texte. */
export const BRAND_TEXT_CLASS = 'font-brand font-bold tracking-[-0.04em] normal-case'

type Tone = 'brand' | 'white' | 'auto'

const TEXT_TONE: Record<Tone, string> = {
  brand: 'text-stockshop-blue',
  white: 'text-white',
  auto: 'text-stockshop-blue dark:text-white',
}
// Icône bleue d'origine ; en blanc via filtre (comme le reste de l'app)
const ICON_TONE: Record<Tone, string> = {
  brand: '',
  white: 'brightness-0 invert',
  auto: 'dark:brightness-0 dark:invert',
}

interface BrandLogoProps {
  /** « row » : icône à gauche du nom ; « stacked » : icône au-dessus (pages d'accueil de connexion). */
  layout?: 'row' | 'stacked'
  /** « brand » bleu, « white » sur fond foncé, « auto » bleu en clair / blanc en sombre. */
  tone?: Tone
  showIcon?: boolean
  className?: string
}

export function BrandLogo({ layout = 'row', tone = 'auto', showIcon = true, className }: BrandLogoProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center',
        layout === 'stacked' ? 'flex-col gap-[0.3em]' : 'flex-row gap-[0.3em]',
        className,
      )}
      aria-label="StockShop"
      role="img"
    >
      {showIcon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/stockshop-icon.png"
          alt=""
          aria-hidden="true"
          // Icône recadrée au cercle (sans marge) : 1,6 em ≈ proportion du logo d'origine
          className={cn('w-auto object-contain', layout === 'stacked' ? 'h-[2.4em]' : 'h-[1.6em]', ICON_TONE[tone])}
        />
      )}
      <span aria-hidden="true" className={cn(BRAND_TEXT_CLASS, 'whitespace-nowrap leading-none', TEXT_TONE[tone])}>
        StockShop
      </span>
    </span>
  )
}
