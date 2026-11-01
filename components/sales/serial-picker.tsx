'use client'

// Caisse › numéros de série d'un produit suivi (étape 11 du Stock, 1er nov. 2026) : un numéro par unité vendue.
// En ligne : numéros EN STOCK de la boutique (choix, recherche, scan) ; le serveur revérifie à l'encaissement.
// Hors ligne : saisie ou scan libre (liste indisponible) ; à la synchronisation, un numéro inconnu rend la vente
// « à vérifier », jamais refusée.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Hash, ScanLine, X } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils/cn'

export function SerialPicker({ open, onOpenChange, product, shopId, isOnline, initial, max, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: { id: string; name: string } | null
  shopId: string | null
  isOnline: boolean
  initial: string[]
  /** Unités vendables : jamais plus de numéros que cela */
  max: number
  onConfirm: (serials: string[]) => void
}) {
  const t = useTranslations('serials')
  const [available, setAvailable] = useState<string[] | null>(null)
  const [chosen, setChosen] = useState<string[]>(initial)
  const [entry, setEntry] = useState('')
  const [error, setError] = useState<string | null>(null)
  const entryRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !product) return
    setChosen(initial); setEntry(''); setError(null); setAvailable(null)
    if (!isOnline || !shopId) return
    let cancelled = false
    fetch(`/api/products/serials?shop_id=${shopId}&product_id=${product.id}&status=in_stock`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (!cancelled) setAvailable(j ? (j.data || []).map((x: any) => x.serial) : []) })
      .catch(() => { if (!cancelled) setAvailable([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id, shopId, isOnline])

  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
  const isChosen = (s: string) => chosen.some(c => same(c, s))
  const filtered = useMemo(() => {
    const q = entry.trim().toUpperCase()
    return (available || []).filter(s => !q || s.toUpperCase().includes(q)).slice(0, 200)
  }, [available, entry])

  const toggle = (s: string) => {
    setError(null)
    if (isChosen(s)) { setChosen(prev => prev.filter(c => !same(c, s))); return }
    if (chosen.length >= max) { setError(t('max_reached', { count: max })); return }
    setChosen(prev => [...prev, s])
  }
  // Saisie / scan + Entrée : en ligne, le numéro doit être en stock ; hors ligne, il est pris tel quel
  const addEntry = () => {
    const s = entry.trim()
    if (!s) return
    if (s.length > 64) { setError(t('invalid')); return }
    if (isChosen(s)) { setEntry(''); return }
    if (isOnline && available) {
      const match = available.find(a => same(a, s))
      if (!match) { setError(t('not_in_stock', { serial: s })); return }
      if (chosen.length >= max) { setError(t('max_reached', { count: max })); return }
      setChosen(prev => [...prev, match])
    } else {
      if (chosen.length >= max) { setError(t('max_reached', { count: max })); return }
      setChosen(prev => [...prev, s])
    }
    setEntry(''); setError(null)
    entryRef.current?.focus()
  }

  return (
    <PremiumDialog open={open} onOpenChange={onOpenChange} category={t('category')} title={product?.name || ''}
      icon={<Hash className="h-4 w-4" />} maxWidth="max-w-md" testId="serial-picker">
      <PremiumDialogBody>
        <p className="text-sm text-muted-foreground">{isOnline ? t('hint_online') : t('hint_offline')}</p>
        <div className="relative">
          <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input ref={entryRef} value={entry} onChange={e => { setEntry(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addEntry() } }}
            placeholder={isOnline ? t('search_placeholder') : t('entry_placeholder')} className="h-11 pl-9 font-mono placeholder:font-sans" data-testid="serial-entry" />
        </div>
        {error && <p role="alert" className="text-sm text-destructive" data-testid="serial-error">{error}</p>}

        {chosen.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="serial-chosen">
            {chosen.map(s => (
              <span key={s} className="inline-flex items-center gap-1 rounded-full bg-stockshop-blue-muted px-2.5 py-1 font-mono text-xs text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">
                {s}
                <button type="button" onClick={() => toggle(s)} aria-label={t('remove', { serial: s })} className="-mr-1 rounded-full p-0.5 hover:bg-white/60 dark:hover:bg-blue-900/40"><X className="h-3 w-3" /></button>
              </span>
            ))}
          </div>
        )}

        {isOnline && (
          available === null ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : available.length === 0 ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground" data-testid="serial-none">{t('none_in_stock')}</p>
          ) : (
            <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border" data-testid="serial-list">
              {filtered.map(s => (
                <li key={s}>
                  <button type="button" onClick={() => toggle(s)} aria-pressed={isChosen(s)}
                    className={cn('flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left font-mono text-sm', isChosen(s) ? 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted/60')}>
                    {s}{isChosen(s) && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </PremiumDialogBody>
      <PremiumDialogFooter onCancel={() => onOpenChange(false)} onConfirm={() => { onConfirm(chosen); onOpenChange(false) }}
        confirmLabel={chosen.length ? t('confirm', { count: chosen.length }) : t('confirm_none')} confirmDisabled={chosen.length === 0 && initial.length === 0} />
    </PremiumDialog>
  )
}
