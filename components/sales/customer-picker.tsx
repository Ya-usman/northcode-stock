'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Search, UserPlus, Users, X } from 'lucide-react'
import { PremiumDialog } from '@/components/ui/premium-dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'
import { normalize } from '@/lib/utils/normalize'
import { phoneMatches } from '@/lib/phone/compare'
import type { Customer } from '@/lib/types/database'

// Sélecteur de client de la caisse : un vrai carnet (recherche par nom ou
// numéro, Récents / Tous / Avec solde, « Nouveau client ») à la place d'une
// liste déroulante cachée sous un champ. « Récents » = clients des dernières
// ventes, pas les derniers créés : c'est ce qui fait gagner du temps au
// comptoir. Le solde dû est visible sur la ligne — ce qu'un vendeur cherche
// le plus souvent avant d'accorder un crédit.

type Tab = 'recent' | 'all' | 'debt'

/** Exemple de numéro local pour l'aide du champ téléphone, selon le pays de la boutique. */
export function phoneExample(country: string | null | undefined, phonePrefix: string): string {
  const EXAMPLES: Record<string, string> = {
    NG: '0803 123 4567', CM: '6 12 34 56 78', CI: '07 12 34 56 78', SN: '77 123 45 67',
    BF: '70 12 34 56', ML: '76 12 34 56', TG: '90 12 34 56', BJ: '97 12 34 56',
    NE: '96 12 34 56', GH: '024 123 4567', GN: '620 12 34 56', CD: '081 234 5678',
    FR: '06 12 34 56 78', BE: '0470 12 34 56', MA: '06 12 34 56 78',
  }
  return EXAMPLES[country || ''] ?? `${phonePrefix} …`
}

export function CustomerPicker({ open, onOpenChange, customers, recentIds, initialQuery = '', onSelect, onCreateNew, formatAmount }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  customers: Customer[]
  /** Identifiants des clients des dernières ventes, du plus récent au plus ancien (vide hors ligne). */
  recentIds: string[]
  /** Texte déjà tapé dans le champ « nouveau client » : la recherche démarre dessus. */
  initialQuery?: string
  onSelect: (customer: Customer) => void
  onCreateNew: () => void
  formatAmount: (n: number) => string
}) {
  const t = useTranslations()
  const [query, setQuery] = useState(initialQuery)
  const [tab, setTab] = useState<Tab>('all')

  // À chaque ouverture : recherche pré-remplie, onglet Récents s'il y en a
  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setTab(recentIds.length && !initialQuery ? 'recent' : 'all')
  }, [open, initialQuery, recentIds.length])

  const q = normalize(query)
  // Numéro : « 0753… » trouve aussi « +33 7 53… » (zéro initial ignoré)
  const matches = (c: Customer) =>
    !q || normalize(c.name).includes(q) || phoneMatches(c.phone, query)

  const recent = recentIds.map(id => customers.find(c => c.id === id)).filter((c): c is Customer => !!c)
  const withDebt = customers.filter(c => Number(c.total_debt) > 0)
  const base = tab === 'recent' ? recent : tab === 'debt' ? withDebt : customers
  const list = base.filter(matches).slice(0, 200)

  const tabs: { id: Tab; label: string; count: number }[] = [
    ...(recentIds.length ? [{ id: 'recent' as Tab, label: t('sales.customer_tab_recent'), count: recent.length }] : []),
    { id: 'all', label: t('sales.customer_tab_all'), count: customers.length },
    ...(withDebt.length ? [{ id: 'debt' as Tab, label: t('sales.customer_tab_debt'), count: withDebt.length }] : []),
  ]

  return (
    <PremiumDialog open={open} onOpenChange={onOpenChange} title={t('sales.customer_picker_title')} icon={<Users className="h-4 w-4" />} maxWidth="max-w-md">
      <div className="flex-shrink-0 space-y-3 bg-background px-4 pb-2 pt-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && list.length) onSelect(list[0]) }}
            placeholder={t('sales.customer_search_placeholder')}
            className="pl-9 pr-9"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label={t('actions.clear')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {/* Sur un petit écran, « Nouveau client » passe sous les onglets plutôt que de se couper */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            {tabs.map(tb => (
              <button key={tb.id} type="button" onClick={() => setTab(tb.id)}
                className={cn('whitespace-nowrap rounded-md px-3 py-1.5 transition-colors', tab === tb.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {tb.label} <span className="opacity-60">{tb.count}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onCreateNew}
            className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-stockshop-blue hover:underline dark:text-blue-400">
            <UserPlus className="h-4 w-4" /> {t('sales.customer_new')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Users className="h-8 w-8 opacity-40" />
            {t('sales.customer_none_found')}
            <button type="button" onClick={onCreateNew} className="mt-1 font-semibold text-stockshop-blue hover:underline dark:text-blue-400">
              {t('sales.customer_new')}{query ? ` : « ${query} »` : ''}
            </button>
          </div>
        ) : list.map(c => {
          const debt = Number(c.total_debt) || 0
          return (
            <button key={c.id} type="button" onClick={() => onSelect(c)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-base font-semibold text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400" aria-hidden="true">
                {(c.name.trim().charAt(0) || '?').toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {c.phone || t('sales.no_phone')}{c.city ? ` · ${c.city}` : ''}
                </span>
              </span>
              {debt > 0 && (
                <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950/40 dark:text-red-300">
                  {formatAmount(debt)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </PremiumDialog>
  )
}
