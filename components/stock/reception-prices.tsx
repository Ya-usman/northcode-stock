'use client'

// Prix de vente revus à la réception (prix de gros par paliers, 2 nov. 2026) : à chaque entrée de marchandise, le prix
// de détail et les paliers de gros sont PROPOSÉS avec leurs marges sur le nouveau coût. On garde en un geste (rien à
// taper) ou on modifie sur place ; une marge négative ouvre la ligne en rouge et demande une décision (corriger, ou
// confirmer la vente sous le coût). Le prix vaut pour tout le stock du produit. Modifier exige le droit de modifier les
// produits ; sans lui, les prix sont seulement rappelés. Les marges ne sont montrées qu'à qui voit les coûts.
// Règle des paliers : lib/products/price-tiers (la même que le formulaire et le serveur).
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, PencilLine, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { MAX_TIERS, normalizeTiers, type PriceTier } from '@/lib/products/price-tiers'

export interface PricedForReview { selling_price: number; price_tiers?: PriceTier[] | null; unit?: string | null }
interface TierRow { min: string; price: string }
export interface PriceReview { selling: string; tiers: TierRow[]; lossConfirmed: boolean; open: boolean }

const tiersOfProduct = (p: PricedForReview): PriceTier[] => (Array.isArray(p.price_tiers) ? p.price_tiers : [])
export const initialPriceReview = (p: PricedForReview): PriceReview => ({
  selling: String(Number(p.selling_price) || ''),
  tiers: tiersOfProduct(p).map(x => ({ min: String(x.min_qty), price: String(Number(x.price)) })),
  lossConfirmed: false, open: false,
})

const num = (s: string) => (s.trim() === '' ? null : Number(s))
const asInput = (r: PriceReview) => r.tiers.map(x => ({ min_qty: num(x.min), price: num(x.price) }))
// Marge exacte (en %) : jamais arrondie avant de juger son signe (−0,04 % est une perte, pas « 0 % »)
const margin = (price: number | null, cost: number | null) => (price && price > 0 && cost !== null && cost > 0 ? ((price - cost) / price) * 100 : null)

/** Champs à envoyer (PATCH /api/products) ; null s'il n'y a rien de changé */
export function priceReviewChanges(p: PricedForReview, r: PriceReview): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  const s = num(r.selling)
  if (s !== null && s !== Number(p.selling_price)) out.selling_price = s
  const next = normalizeTiers(asInput(r), s ?? Number(p.selling_price))
  const cur = tiersOfProduct(p).map(x => ({ min_qty: Number(x.min_qty), price: Number(x.price) }))
  if (next.ok && JSON.stringify(next.tiers ?? []) !== JSON.stringify(cur)) out.price_tiers = next.tiers
  return Object.keys(out).length ? out : null
}

/** Ce qui empêche d'enregistrer la réception (clé de texte), ou null */
export function priceReviewProblem(_p: PricedForReview, r: PriceReview, unitCost: number | null): string | null {
  const s = num(r.selling)
  if (s === null || !(s > 0)) return 'review_retail_invalid'
  const t = normalizeTiers(asInput(r), s)
  if (!t.ok) return t.problem === 'not_below' ? 'review_wholesale_not_below' : t.problem === 'order' ? 'review_wholesale_order' : t.problem === 'min' ? 'review_wholesale_min' : 'review_wholesale_incomplete'
  const lowest = t.tiers?.length ? t.tiers[t.tiers.length - 1].price : null
  const loss = unitCost !== null && unitCost > 0 && (s < unitCost || (lowest !== null && lowest < unitCost))
  if (loss && !r.lossConfirmed) return 'review_loss_unconfirmed'
  return null
}

export function ReceptionPrices({ product, unitCost, seesCost, canEdit, value, onChange, currency, unitLabel }: {
  product: PricedForReview
  /** Coût à la pièce de cette réception (null : inconnu, non saisi, ou pas le droit de le voir) */
  unitCost: number | null
  seesCost: boolean
  canEdit: boolean
  value: PriceReview
  onChange: (v: PriceReview) => void
  currency: string
  unitLabel: (unit: string, n: number) => string
}) {
  const t = useTranslations('wholesale')
  const locale = useLocale()
  const money = (n: number) => `${Math.round(n).toLocaleString(locale)} ${currency}`
  const cost = seesCost ? unitCost : null
  const s = num(value.selling)
  const tiers = value.tiers.map(x => ({ min: num(x.min), price: num(x.price) }))
  const prices = [s, ...tiers.map(x => x.price)].filter((x): x is number => x !== null)
  const loss = cost !== null && cost > 0 && prices.some(x => x < cost)
  const open = value.open || loss
  const set = (patch: Partial<PriceReview>) => onChange({ ...value, ...patch })
  const setTier = (i: number, patch: Partial<TierRow>) => set({ tiers: value.tiers.map((x, j) => (j === i ? { ...x, ...patch } : x)), lossConfirmed: false })
  const pct = (x: number | null) => (x === null ? null : <span className={cn('tabular-nums', x < 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{t('review_margin', { percent: x.toLocaleString(locale, { maximumFractionDigits: Math.abs(x) < 1 ? 2 : 0 }) })}</span>)
  const unit = product.unit || 'piece'

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', loss ? 'border-red-300 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20' : 'border-border')} data-testid="reception-prices">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="font-medium">{t('review_title')}</p>
          {!open && (
            <p className="text-xs text-muted-foreground" data-testid="reception-prices-summary">
              {t('review_retail', { price: s !== null ? money(s) : '…' })} {pct(margin(s, cost))}
              {tiers.filter(x => x.min !== null && x.price !== null).map((x, i) => (
                <span key={i}> · {t('review_wholesale', { price: money(x.price as number), min: x.min as number, unit: unitLabel(unit, x.min as number) })} {pct(margin(x.price, cost))}</span>
              ))}
            </p>
          )}
        </div>
        {canEdit && !open && (
          <Button type="button" variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => set({ open: true })} data-testid="reception-prices-edit">
            <PencilLine className="h-4 w-4" />{t('review_edit')}
          </Button>
        )}
      </div>
      {open && (
        <>
          {loss && <p className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300" data-testid="reception-prices-loss"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('review_loss', { cost: money(cost!) })}</p>}
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">{t('review_retail_label')}</span>
            <Input inputMode="numeric" value={value.selling} disabled={!canEdit} onChange={e => set({ selling: e.target.value.replace(/[^\d.]/g, ''), lossConfirmed: false })} className="h-10" data-testid="reception-retail" />
            {pct(margin(s, cost))}
          </label>
          {value.tiers.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2" data-testid="reception-tier">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">{t('review_min_label')}</span>
                <Input inputMode="numeric" value={x.min} disabled={!canEdit} onChange={e => setTier(i, { min: e.target.value.replace(/\D/g, '') })} className="h-10" data-testid="reception-wholesale-min" />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">{t('review_wholesale_label')}</span>
                <Input inputMode="numeric" value={x.price} disabled={!canEdit} onChange={e => setTier(i, { price: e.target.value.replace(/[^\d.]/g, '') })} className="h-10" data-testid="reception-wholesale" />
                {pct(margin(num(x.price), cost))}
              </label>
              {canEdit && (
                <Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground" aria-label={t('remove_tier')} onClick={() => set({ tiers: value.tiers.filter((_, j) => j !== i), lossConfirmed: false })}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {canEdit && value.tiers.length < MAX_TIERS && (
            <button type="button" onClick={() => set({ tiers: [...value.tiers, { min: '', price: '' }] })} className="h-8 rounded-full px-2.5 text-xs font-medium text-stockshop-blue hover:bg-stockshop-blue-muted dark:text-blue-400 dark:hover:bg-blue-950/40" data-testid="reception-tier-add">
              {t('add_tier')}
            </button>
          )}
          {!canEdit && <p className="text-xs text-muted-foreground">{t('review_read_only')}</p>}
          {loss && canEdit && (
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={value.lossConfirmed} onChange={e => set({ lossConfirmed: e.target.checked })} data-testid="reception-prices-loss-ok" />
              <span>{t('review_loss_confirm')}</span>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">{t('review_scope')}</p>
        </>
      )}
    </div>
  )
}
