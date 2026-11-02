'use client'

// Bloc « Vente à la mesure » du formulaire produit (migration 203, 2 nov. 2026) : verre, boîte, seau, sac, pack…
// Chaque mesure est indépendante : son propre prix, et un contenu (en unités de stock) qui sert seulement à décompter
// le stock. Grains en grammes : contenu approximatif en g (« soit 8 kg » affiché en direct) ; kilo, demi-kilo et litre
// ont un contenu fixe. Règles : lib/products/sale-measures (les mêmes que le serveur et la base).

import { useLocale, useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { NumericInput } from '@/components/ui/numeric-input'
import { InputGroup } from '@/components/ui/input-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import {
  MAX_MEASURES, MEASURE_KEYS, MEASURE_LABEL_MAX, fixedUnits, isFineUnit, stockAmount, suggestedKeys,
} from '@/lib/products/sale-measures'

export interface MeasureRow { key?: string | null; label?: string | null; units?: number | null; price?: number | null }

interface Props {
  rows: MeasureRow[]
  onChange: (rows: MeasureRow[]) => void
  /** Unité de stock du produit (g, kg, pièce…) */
  unit: string
  currency: string
  error?: string
  /** Produit suivi par numéro de série : vendu à l'unité, pas de mesure */
  disabled?: boolean
}

export function SaleMeasuresField({ rows, onChange, unit, currency, error, disabled }: Props) {
  const t = useTranslations('measures')
  const unitLabel = useUnitLabel()
  const locale = useLocale()
  const shown = rows.length ? rows : [{ key: null, label: null, units: null, price: null }]
  const write = (next: MeasureRow[]) => onChange(next)
  const setRow = (i: number, patch: MeasureRow) => write(shown.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i: number) => write(shown.length > 1 ? shown.filter((_, j) => j !== i) : [])
  const add = () => { if (shown.length < MAX_MEASURES) write([...shown, { key: null, label: null, units: null, price: null }]) }
  // Mesures utiles pour cette unité d'abord, les autres ensuite, « Autre » en dernier
  const first = suggestedKeys(unit)
  const order = [...first, ...MEASURE_KEYS.filter(k => k !== 'custom' && !first.includes(k)), 'custom' as const]
  const fine = isFineUnit(unit)
  const whole = unit === 'kg' || unit === 'litre'
  const baseLabel = (n: number) => unitLabel(unit, n)

  if (disabled) return <p className="text-xs text-muted-foreground" data-testid="product-measures-serials">{t('serials_none')}</p>

  return (
    <div className="space-y-2" data-testid="product-measures">
      <p className="text-xs text-muted-foreground">
        {t('hint')} {fine ? (unit === 'ml' ? t('hint_fine_volume') : t('hint_fine')) : null}
      </p>
      {whole && <p className="text-xs text-muted-foreground" data-testid="product-measures-whole">{t('hint_whole', { unit: unitLabel(unit, 2) })}</p>}
      {shown.map((row, i) => {
        const fixed = row.key ? fixedUnits(row.key, unit) : null
        const units = Number(row.units) || 0
        const big = fine && units >= 1000 ? stockAmount(units, unit, locale) : null
        return (
          <div key={i} className="space-y-1.5 rounded-md bg-muted/40 p-2" data-testid="product-measure">
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{t('measure_label')}</Label>
                <Select value={row.key || undefined} onValueChange={v => {
                  const f = fixedUnits(v, unit)
                  setRow(i, { key: v, label: v === 'custom' ? row.label ?? '' : null, units: f ?? (fixedUnits(row.key || '', unit) !== null ? null : row.units ?? null) })
                }}>
                  <SelectTrigger className="h-10" data-testid="product-measure-key"><SelectValue placeholder={t('measure_label')} /></SelectTrigger>
                  <SelectContent>
                    {order.map(k => (
                      <SelectItem key={k} value={k}>{k === 'custom' ? t('labels.custom') : capitalize(t(`labels.${k}` as any, { count: 1 }))}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground" onClick={() => remove(i)} aria-label={t('remove')}
                disabled={shown.length === 1 && !row.key && !row.price && !row.units}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {row.key === 'custom' && (
              <Input value={row.label ?? ''} onChange={e => setRow(i, { label: e.target.value })} maxLength={MEASURE_LABEL_MAX}
                placeholder={t('custom_placeholder')} className="h-10" data-testid="product-measure-label" aria-label={t('custom_placeholder')} />
            )}
            <div className="grid grid-cols-2 items-start gap-2">
              <div className="space-y-1">
                <Label className="text-xs">{t('price_label')}</Label>
                <InputGroup suffix={currency}>
                  <NumericInput allowEmpty value={row.price ?? null} onChange={v => setRow(i, { price: v })} placeholder="0" className="h-10" data-testid="product-measure-price" aria-label={t('price_label')} />
                </InputGroup>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{fixed !== null ? t('content_fixed') : t('content_label')}</Label>
                {fixed !== null ? (
                  <p className="flex h-10 items-center text-sm text-muted-foreground" data-testid="product-measure-fixed">{stockAmount(fixed, unit, locale).value} {unitLabel(stockAmount(fixed, unit, locale).unit, 1)}</p>
                ) : (
                  <InputGroup suffix={baseLabel(units || 2)}>
                    <NumericInput allowEmpty value={row.units ?? null} onChange={v => setRow(i, { units: v })} placeholder={fine ? '250' : '24'} className="h-10" data-testid="product-measure-units" aria-label={t('content_label')} />
                  </InputGroup>
                )}
                {big && fixed === null && <p className="text-[11px] text-muted-foreground" data-testid="product-measure-big">{t('about', { amount: `${big.value} ${unitLabel(big.unit, big.count)}` })}</p>}
              </div>
            </div>
          </div>
        )
      })}
      {shown.length < MAX_MEASURES && (
        <button type="button" onClick={add} className="h-8 rounded-full px-2.5 text-xs font-medium text-stockshop-blue hover:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40" data-testid="product-measure-add">
          {t('add')}
        </button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export const capitalize = (s: string) => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
