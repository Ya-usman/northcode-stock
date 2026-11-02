'use client'

// Caisse : choix de la mesure vendue (migration 203, 2 nov. 2026). Un bouton par mesure, avec son prix (« Boîte ·
// 550 F ») et son contenu en petit ; l'unité de base en premier quand le produit se vend aussi à l'unité. Un appui
// ajoute 1 mesure au panier et ferme ; on règle ensuite le nombre sur la ligne du panier.

import { useLocale, useTranslations } from 'next-intl'
import { Ruler } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody } from '@/components/ui/premium-dialog'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { capitalize } from '@/components/stock/sale-measures-field'
import { cn } from '@/lib/utils/cn'
import {
  measureContent, measureName, measuresOf, soldOnlyByMeasures, stockAmount, FINE_FACTOR, isFineUnit, type SaleMeasure,
} from '@/lib/products/sale-measures'
import type { Product } from '@/lib/types/database'

interface Props {
  product: Product | null
  onClose: () => void
  /** Stock encore libre pour ce produit (vendable − déjà au panier), en unités de stock */
  room: number
  /** Prix à l'unité en vigueur (promo, gros au premier article) */
  unitPrice: number
  fmt: (n: number) => string
  onPickUnit: (product: Product) => void
  onPickMeasure: (product: Product, m: SaleMeasure) => void
}

export function MeasurePicker({ product, onClose, room, unitPrice, fmt, onPickUnit, onPickMeasure }: Props) {
  const t = useTranslations('measures')
  const unitLabel = useUnitLabel()
  const locale = useLocale()
  const tm = t as unknown as (key: string, values?: Record<string, string | number>) => string
  const measures = product ? measuresOf(product) : []
  const unit = product?.unit || 'piece'
  const left = stockAmount(Math.max(0, room), unit, locale)
  const btn = 'flex min-h-[56px] w-full items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left transition-colors'
  return (
    <PremiumDialog open={!!product} onOpenChange={o => { if (!o) onClose() }} category={t('pick_title')} title={product?.name ?? ''}
      icon={<Ruler className="h-4 w-4" />} maxWidth="max-w-sm" testId="measure-picker">
      {product && (
        <PremiumDialogBody>
          <p className="text-xs text-muted-foreground">{t('pick_hint')} {t('pick_stock', { amount: `${left.value} ${unitLabel(left.unit, left.count)}` })}</p>
          <div className="space-y-2">
            {!soldOnlyByMeasures(product) && (
              <button type="button" disabled={room < 1} onClick={() => { onPickUnit(product); onClose() }} data-testid="measure-pick-unit"
                className={cn(btn, room < 1 ? 'cursor-not-allowed opacity-50' : 'hover:border-stockshop-blue hover:bg-stockshop-blue-muted dark:hover:border-blue-500 dark:hover:bg-blue-950/40')}>
                <span className="text-sm font-medium">{t('pick_unit')} <span className="font-normal text-muted-foreground">({unitLabel(unit, 1)})</span></span>
                <span className="text-sm font-bold text-stockshop-blue dark:text-blue-400">
                  {isFineUnit(unit) ? `${fmt(unitPrice * FINE_FACTOR)} / ${unitLabel(unit === 'ml' ? 'litre' : 'kg', 1)}` : fmt(unitPrice)}
                </span>
              </button>
            )}
            {measures.map(m => {
              const ok = room >= m.units
              return (
                <button key={`${m.key}|${m.label ?? ''}`} type="button" disabled={!ok} onClick={() => { onPickMeasure(product, m); onClose() }} data-testid="measure-pick"
                  className={cn(btn, ok ? 'hover:border-stockshop-blue hover:bg-stockshop-blue-muted dark:hover:border-blue-500 dark:hover:bg-blue-950/40' : 'cursor-not-allowed opacity-50')}>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{capitalize(measureName(m, 1, tm))}</span>
                    <span className="block text-[11px] text-muted-foreground">{measureContent(m, unit, unitLabel, tm, locale)}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-stockshop-blue dark:text-blue-400">{fmt(m.price)}</span>
                </button>
              )
            })}
          </div>
        </PremiumDialogBody>
      )}
    </PremiumDialog>
  )
}
