'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils/cn'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { refocusTopModal, useModalStack } from '@/components/ui/modal-stack'
import {
  compactLabel, flatOptions, searchGroups, toggleValue,
  type FilterGroup,
} from '@/lib/filters/multi-select'

// ── MultiSelectFilter ────────────────────────────────────────────────────────
// Filtre de liste à choix multiple, commun à toute l'application.
// - Déclencheur compact : « Catégorie » (rien de choisi), « Alimentation » (une
//   valeur), « Catégorie · 2 » (plusieurs).
// - « Toutes » = aucune restriction : le choisir vide la sélection ; dès qu'une
//   valeur est cochée, « Toutes » n'est plus coché.
// - Ordinateur : fenêtre ancrée au bouton ; par défaut chaque case s'applique
//   tout de suite (applyMode = 'immediate'), ou au bouton Appliquer ('apply') pour
//   une page qui interroge le serveur.
// - Téléphone : panneau du bas ; on coche plusieurs valeurs puis Appliquer (la page
//   ne se recalcule pas à chaque case) ; Réinitialiser vide le brouillon.
// - Groupes (une boutique = un groupe titré) seulement si la page en fournit, en
//   « Toutes les boutiques ». Chaque option garde son identifiant.
// - Recherche seulement pour une longue liste (plus de 8 options par défaut).
// - Clavier : flèches, Début/Fin, Espace/Entrée pour cocher, Échap pour fermer.

const SEARCH_THRESHOLD = 8

function useIsPhone(): boolean {
  const [phone, setPhone] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const update = () => setPhone(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return phone
}

export interface MultiSelectListProps {
  /** Nom de la dimension (« Catégorie »), pour les lecteurs d'écran */
  label: string
  /** Ligne « Toutes » (« Toutes les catégories ») */
  allLabel: string
  groups: FilterGroup[]
  selected: string[]
  onToggle: (value: string) => void
  onClear: () => void
  searchable?: boolean
  /** Toujours 48 px (panneau du bas) ; sinon 48 px sur téléphone, 40 px au-delà */
  large?: boolean
  /** Hauteur maximale de la liste (classe Tailwind) */
  maxHeightClass?: string
  autoFocusSearch?: boolean
  testId?: string
  /** Icône éventuelle d'une option, par valeur */
  optionIcon?: (value: string) => React.ReactNode
}

/** La liste seule (recherche, « Toutes », groupes, cases) : réutilisable dans un panneau existant */
export function MultiSelectList({
  label, allLabel, groups, selected, onToggle, onClear, searchable, large = false,
  maxHeightClass = 'max-h-72', autoFocusSearch = false, testId, optionIcon,
}: MultiSelectListProps) {
  const t = useTranslations('filters')
  const [query, setQuery] = React.useState('')
  const total = flatOptions(groups).length
  const withSearch = searchable ?? total > SEARCH_THRESHOLD
  const shown = withSearch ? searchGroups(groups, query) : groups
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  // Navigation au clavier entre les lignes (« Toutes » comprise)
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
  const move = (from: HTMLElement | null, delta: number | 'first' | 'last') => {
    const all = rows()
    if (!all.length) return
    const i = from ? all.indexOf(from) : -1
    const next = delta === 'first' ? 0 : delta === 'last' ? all.length - 1 : Math.min(all.length - 1, Math.max(0, i + delta))
    all[next]?.focus()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.getAttribute('role') !== 'option') return
    if (e.key === 'ArrowDown') { e.preventDefault(); move(target, 1) }
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows()[0] === target && withSearch) listRef.current?.parentElement?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      else move(target, -1)
    }
    else if (e.key === 'Home') { e.preventDefault(); move(target, 'first') }
    else if (e.key === 'End') { e.preventDefault(); move(target, 'last') }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); target.click() }
  }

  const rowClass = cn(
    'flex w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none',
    'hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-stockshop-blue/40 dark:focus-visible:ring-blue-400/40',
    large ? 'min-h-12' : 'min-h-12 sm:min-h-10',
  )
  const box = (on: boolean) => (
    <span aria-hidden className={cn(
      'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border',
      on ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500 dark:bg-blue-500' : 'border-input bg-background',
    )}>
      {on && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  )
  const noneSelected = selected.length === 0

  return (
    <div className="flex min-h-0 flex-col gap-2" data-testid={testId}>
      {withSearch && (
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); move(null, 'first') } }}
            placeholder={t('search')}
            aria-label={t('search_in', { label })}
            aria-controls={listId}
            autoFocus={autoFocusSearch}
            className={cn('w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue/40', large ? 'h-12' : 'h-12 sm:h-9')}
            data-filter-search
          />
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable="true"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn('min-h-0 overflow-y-auto overscroll-contain', maxHeightClass)}
      >
        {/* « Toutes » : coché tant que rien n'est choisi ; le choisir vide la sélection */}
        {!query && (
          <div role="option" aria-selected={noneSelected} tabIndex={0} className={cn(rowClass, 'font-medium')} onClick={onClear} data-filter-all>
            {box(noneSelected)}
            <span className="min-w-0 flex-1 truncate">{allLabel}</span>
          </div>
        )}
        {shown.map(g => (
          <div key={g.id} role="group" aria-label={g.label}>
            {g.label && (
              <div role="presentation" className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" data-filter-group>
                {g.label}
              </div>
            )}
            {g.options.map(o => {
              const on = selected.includes(o.value)
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={on}
                  tabIndex={-1}
                  className={rowClass}
                  onClick={() => onToggle(o.value)}
                  data-filter-option={o.value}
                >
                  {box(on)}
                  {optionIcon?.(o.value)}
                  {o.color && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.hint}</span>}
                </div>
              )
            })}
          </div>
        ))}
        {withSearch && query && shown.length === 0 && (
          <p className="px-2.5 py-3 text-sm text-muted-foreground">{t('no_results')}</p>
        )}
      </div>
    </div>
  )
}

export interface MultiSelectFilterProps {
  label: string
  allLabel: string
  groups: FilterGroup[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Valeurs qui ne se combinent avec aucune autre (ex. Archivé) */
  exclusive?: string[]
  searchable?: boolean
  /** Ordinateur : 'immediate' (défaut) ou 'apply'. Le téléphone utilise toujours Appliquer. */
  applyMode?: 'immediate' | 'apply'
  className?: string
  testId?: string
  optionIcon?: (value: string) => React.ReactNode
}

export function MultiSelectFilter({
  label, allLabel, groups, selected, onChange, exclusive = [], searchable,
  applyMode = 'immediate', className, testId, optionIcon,
}: MultiSelectFilterProps) {
  const t = useTranslations('filters')
  const phone = useIsPhone()
  const [open, setOpen] = React.useState(false)
  // Brouillon : téléphone ou mode « Appliquer » ; sinon chaque case s'applique tout de suite
  const deferred = phone || applyMode === 'apply'
  const [draft, setDraft] = React.useState<string[]>(selected)
  React.useEffect(() => { if (open) setDraft(selected) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = deferred ? draft : selected
  const set = (next: string[]) => (deferred ? setDraft(next) : onChange(next))
  const toggle = (v: string) => set(toggleValue(current, v, exclusive))
  const apply = () => { onChange(draft); setOpen(false) }

  const contentRef = React.useRef<HTMLDivElement>(null)
  // Pile commune : Échap ferme ce niveau même si un message (toast) est affiché
  useModalStack(open, () => setOpen(false), contentRef)

  const c = compactLabel(label, selected, groups)
  const text = c.kind === 'many' ? t('compact', { label, count: c.count }) : c.text
  const active = selected.length > 0
  const trigger = (
    <button
      type="button"
      aria-haspopup={phone ? 'dialog' : 'listbox'}
      aria-expanded={open}
      aria-label={active ? t('aria_value', { label, value: text }) : label}
      title={active && c.kind === 'one' ? text : undefined}
      onClick={phone ? () => setOpen(true) : undefined}
      data-testid={testId}
      data-selected-count={selected.length}
      className={cn(
        // tap-target : même zone tactile minimale que les boutons (48 px)
        'tap-target inline-flex h-9 min-w-0 items-center justify-between gap-1 rounded-md border px-2.5 text-sm outline-none transition-colors sm:px-3',
        'focus-visible:ring-2 focus-visible:ring-stockshop-blue/40 dark:focus-visible:ring-blue-400/40',
        active
          ? 'border-stockshop-blue bg-stockshop-blue-muted text-stockshop-blue dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300'
          : 'border-input bg-background text-foreground hover:bg-muted/60',
        className,
      )}
    >
      <span className="min-w-0 truncate">{text}</span>
      <ChevronDown aria-hidden className="h-4 w-4 shrink-0 opacity-60" />
    </button>
  )

  const footer = (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={() => set([])}
        disabled={current.length === 0}
        className="h-10 rounded-md px-3 text-sm font-medium text-stockshop-blue hover:bg-muted disabled:opacity-40 dark:text-blue-400 max-sm:h-12"
        data-filter-reset
      >
        {t('reset')}
      </button>
      {deferred && (
        <button
          type="button"
          onClick={apply}
          className="h-10 rounded-md bg-stockshop-blue px-5 text-sm font-semibold text-white hover:bg-stockshop-blue/90 dark:bg-blue-500 max-sm:h-12 max-sm:flex-1"
          data-filter-apply
        >
          {t('apply')}
        </button>
      )}
    </div>
  )

  const list = (large: boolean) => (
    <MultiSelectList
      label={label}
      allLabel={allLabel}
      groups={groups}
      selected={current}
      onToggle={toggle}
      onClear={() => set([])}
      searchable={searchable}
      large={large}
      maxHeightClass={large ? 'max-h-[55dvh]' : 'max-h-72'}
      autoFocusSearch={!large}
      optionIcon={optionIcon}
    />
  )

  if (phone) {
    return (
      <>
        {trigger}
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
            <DialogPrimitive.Content
              ref={contentRef}
              aria-describedby={undefined}
              onCloseAutoFocus={refocusTopModal}
              onOpenAutoFocus={e => { e.preventDefault(); contentRef.current?.focus({ preventScroll: true }) }}
              tabIndex={-1}
              className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
              data-testid={testId ? `${testId}-sheet` : undefined}
            >
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                <DialogPrimitive.Title className="text-base font-semibold">{label}</DialogPrimitive.Title>
                <DialogPrimitive.Close className="flex h-12 w-12 items-center justify-center rounded-md text-muted-foreground hover:bg-muted" aria-label={t('close')}>
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
              </div>
              <div className="min-h-0 flex-1 px-3 pt-3">{list(true)}</div>
              <div className="border-t px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom,0px))]">{footer}</div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent ref={contentRef} align="start" className="w-80 max-w-[calc(100vw-2rem)] space-y-2 p-2" data-testid={testId ? `${testId}-popover` : undefined}>
        {list(false)}
        <div className="border-t pt-2">{footer}</div>
      </PopoverContent>
    </Popover>
  )
}
