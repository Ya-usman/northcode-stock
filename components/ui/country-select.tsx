'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Search, Check, ChevronDown, Globe } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { COUNTRIES, type CountryCode, type CountryConfig } from '@/lib/saas/countries'
import { cn } from '@/lib/utils/cn'

// ════════════════════════════════════════════════════════════════════════
// SÉLECTEUR DE PAYS CENTRAL — StockShop
// ════════════════════════════════════════════════════════════════════════
//
// Chaque pays (dont les 27 de l'Union européenne, jamais groupés sous une
// entrée "Europe") est listé individuellement, trié par nom LOCALISÉ selon
// la langue active (fr/en/ha — namespace i18n `countries`), avec une
// recherche instantanée tolérante à la casse et aux accents.
//
// `CountryPickerList` = corps réutilisable (recherche + liste), utilisable
// directement dans une étape plein écran (inscription).
// `CountrySelect`     = bouton déclencheur + CountryPickerList dans une
// boîte de dialogue — pour un formulaire classique (Paramètres, admin…).
// Le code ISO stocké ne change jamais ; seul l'affichage est localisé.

/** Retire les diacritiques pour une recherche tolérante aux accents —
 *  "cote" ou "côte" trouvent tous les deux "Côte d'Ivoire". */
// U+0300–U+036F = bloc Unicode des diacritiques combinants (accents,
// cédilles…) isolés par la décomposition NFD. Exportée pour être testée
// directement (voir scratchpad test-country-phase2 : "cote"/"côte" doivent
// tous deux trouver "Côte d'Ivoire").
const DIACRITICS_RE = /[̀-ͯ]/g
export function foldAccents(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase()
}

interface CountryEntry extends CountryConfig {
  displayName: string
}

/** Les pays supportés, triés par nom localisé selon la langue active. */
function useSortedCountries(): CountryEntry[] {
  const t = useTranslations('countries')
  const locale = useLocale()
  return useMemo(() => {
    return Object.values(COUNTRIES)
      .map(c => ({ ...c, displayName: t(c.code as any) }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, locale))
  }, [t, locale])
}

interface CountryPickerListProps {
  value?: CountryCode | null
  onSelect: (code: CountryCode) => void
  autoFocus?: boolean
  className?: string
  /** Hauteur de la zone de liste (défaut : adaptée à une boîte de dialogue). */
  listClassName?: string
}

/**
 * Corps réutilisable du sélecteur : champ de recherche + liste triée et
 * filtrée. Recherche insensible à la casse et aux accents, sur le nom
 * localisé, le code ISO et le code devise ("cam" → Cameroun, "fra" →
 * France, "ivoire" → Côte d'Ivoire, "xof" → tous les pays XOF).
 */
export function CountryPickerList({ value, onSelect, autoFocus, className, listClassName }: CountryPickerListProps) {
  const t = useTranslations('country_picker')
  const countries = useSortedCountries()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = foldAccents(search.trim())
    if (!q) return countries
    return countries.filter(c =>
      foldAccents(c.displayName).includes(q) ||
      foldAccents(c.code).includes(q) ||
      foldAccents(c.currency).includes(q)
    )
  }, [countries, search])

  return (
    <div className={cn('flex flex-col min-h-0', className)}>
      <div className="relative flex-shrink-0 mb-2">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          autoFocus={autoFocus}
          placeholder={t('search_placeholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border bg-background dark:bg-[#060e1c] dark:border-[#1b2e48] dark:text-[#d8e8ff] dark:placeholder:text-[#2e4460] pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-stockshop-blue/40 placeholder:text-muted-foreground"
        />
      </div>
      <div className={cn('flex-1 min-h-0 overflow-y-auto rounded-xl border border-border divide-y divide-border', listClassName ?? 'max-h-72')}>
        {filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">{t('no_results')}</p>
        )}
        {filtered.map(c => {
          const selected = value === c.code
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => onSelect(c.code)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
                selected && 'bg-blue-50 dark:bg-blue-950/40'
              )}
            >
              <span className="text-xl leading-none flex-shrink-0">{c.flag}</span>
              <div className="flex-1 min-w-0">
                <p className={cn('text-sm font-medium truncate', selected && 'text-stockshop-blue dark:text-blue-400')}>
                  {c.displayName}
                </p>
                <p className="text-xs text-muted-foreground truncate">{c.currencySymbol} · {c.currency}</p>
              </div>
              {selected && <Check className="h-4 w-4 text-stockshop-blue dark:text-blue-400 flex-shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

interface CountrySelectProps {
  value: CountryCode | null | undefined
  onChange: (code: CountryCode) => void
  className?: string
  disabled?: boolean
}

/**
 * Sélecteur de pays complet pour un formulaire classique : bouton
 * déclencheur (drapeau + nom localisé) ouvrant CountryPickerList dans une
 * boîte de dialogue. Responsive par construction (components/ui/dialog.tsx) :
 * centrée sur desktop, repositionnée en feuille pleine largeur proche du
 * haut sur mobile (au-dessus du clavier virtuel).
 */
export function CountrySelect({ value, onChange, className, disabled }: CountrySelectProps) {
  const t = useTranslations('country_picker')
  const tCountries = useTranslations('countries')
  const [open, setOpen] = useState(false)
  const selected = value ? COUNTRIES[value] : null

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(
          'w-full flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-left transition-colors',
          'hover:border-stockshop-blue/50 focus:outline-none focus:ring-2 focus:ring-stockshop-blue/40',
          'disabled:opacity-60 disabled:cursor-not-allowed',
          className
        )}
      >
        {selected ? (
          <>
            <span className="text-lg leading-none flex-shrink-0">{selected.flag}</span>
            <span className="flex-1 truncate">{tCountries(selected.code as any)}</span>
          </>
        ) : (
          <>
            <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 truncate text-muted-foreground">{t('select_country')}</span>
          </>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col p-4 gap-3 max-w-sm max-sm:max-h-[85svh]">
          <DialogTitle className="text-base">{t('select_country')}</DialogTitle>
          <CountryPickerList
            value={value}
            autoFocus
            onSelect={(code) => { onChange(code); setOpen(false) }}
            className="min-h-0 flex-1"
            listClassName="max-h-[55vh]"
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
