'use client'

import { memo, useCallback, useEffect, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { Coins } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils/cn'
import { formatCurrency, formatInputValue } from '@/lib/utils/currency'

interface DebtRepaymentCardProps {
  currencyCode: string
  symbol: string
  /** Dette réelle restante du client (plafond de la saisie). */
  debtOutstanding: number
  enabled: boolean
  /** Saisie brute (chiffres), telle que gardée par la page. */
  amount: string
  capped: boolean
  /** Montant effectivement pris en compte (plafonné), 0 si désactivé. */
  debtAmt: number
  saleTotal: number
  totalToCollect: number
  onToggle: (next: boolean) => void
  onAmountChange: (raw: string) => void
}

// Carte « Inclure un remboursement de crédit » de Nouvelle vente.
// Extraite de la page pour deux défauts mesurés au toucher (CPU ralenti ×6) :
//  - la pastille seule faisait 44 × 24 px : un tap 10 px à côté ne faisait
//    rien → toute la ligne de titre est devenue l'interrupteur ;
//  - chaque bascule redessinait toute la page de vente : 400-700 ms avant que
//    la pastille ne bouge. L'état visuel est local (rendu immédiat), et la
//    mise à jour de la page passe en transition React, non bloquante.
function DebtRepaymentCardImpl({
  currencyCode, symbol, debtOutstanding, enabled, amount, capped, debtAmt, saleTotal, totalToCollect, onToggle, onAmountChange,
}: DebtRepaymentCardProps) {
  const t = useTranslations()
  const fmt = (n: number) => formatCurrency(n, currencyCode)
  const [checked, setChecked] = useState(enabled)
  const [, startTransition] = useTransition()
  // Le parent remet à zéro quand le client change : on suit.
  useEffect(() => { setChecked(enabled) }, [enabled])
  const toggle = useCallback(() => {
    const next = !checked
    setChecked(next)
    startTransition(() => onToggle(next))
  }, [checked, onToggle])

  return (
    <Card className="border border-orange-200 bg-orange-50 shadow-sm dark:border-orange-900/60 dark:bg-orange-950/30">
      <CardContent className="p-4 space-y-3">
        {/* Toute la ligne est l'interrupteur — la carte reste orange (rappel),
            seule la pastille active prend le bleu de marque. */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={toggle}
          className="-mx-2 -my-1 flex min-h-[48px] items-center gap-3 rounded-lg px-2 py-1 text-left transition-colors active:bg-orange-100/70 dark:active:bg-orange-900/30"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300" aria-hidden="true">
            <Coins className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-orange-800 dark:text-orange-200">{t('sales.include_debt_repayment')}</span>
            <span className="block text-xs text-orange-600 dark:text-orange-300/80">
              {t('sales.current_debt_label')} : <strong>{fmt(debtOutstanding)}</strong>
            </span>
          </span>
          <span
            aria-hidden="true"
            className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-stockshop-blue dark:bg-blue-600' : 'bg-gray-300 dark:bg-gray-600')}
          >
            <span className={cn('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-md ring-1 ring-black/10 transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
          </span>
        </button>

        {enabled && (
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <Label className="text-xs text-orange-800 dark:text-orange-200">{t('sales.amount_given_for_debt')}</Label>
              <div className="flex rounded-md border border-orange-200 overflow-hidden focus-within:ring-2 focus-within:ring-orange-300 dark:border-orange-900/60 dark:focus-within:ring-orange-700">
                <span className="flex items-center px-2.5 bg-orange-50 border-r border-orange-200 text-sm text-muted-foreground font-medium whitespace-nowrap select-none dark:bg-orange-950/30 dark:border-orange-900/60">{symbol}</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={formatInputValue(amount, currencyCode)}
                  onChange={e => onAmountChange(e.target.value)}
                  className="flex-1 h-11 px-3 text-base font-bold bg-card outline-none"
                  placeholder="0"
                />
              </div>
              {capped && (
                <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                  {t('sales.debt_capped', { amount: fmt(debtOutstanding) })}
                </p>
              )}
              {debtAmt > 0 && (
                <p className="text-xs text-orange-600 dark:text-orange-300/80">
                  {t('sales.remaining_after')} : <strong>{fmt(Math.max(0, debtOutstanding - debtAmt))}</strong>
                  {debtAmt >= debtOutstanding && ` ${t('sales.debt_settled_check')}`}
                </p>
              )}
            </div>

            {/* Résumé */}
            {debtAmt > 0 && (
              <div className="rounded-lg bg-card border border-orange-200 p-3 space-y-1 text-sm dark:border-orange-900/60">
                <div className="flex justify-between text-muted-foreground">
                  <span>Vente</span><span>{fmt(saleTotal)}</span>
                </div>
                <div className="flex justify-between text-orange-700 dark:text-orange-300">
                  <span>Remboursement crédit</span><span>+{fmt(debtAmt)}</span>
                </div>
                <div className="flex justify-between font-bold border-t pt-1">
                  <span>{t('sales.total_to_collect')}</span>
                  <span className="text-stockshop-blue dark:text-blue-400">{fmt(totalToCollect)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export const DebtRepaymentCard = memo(DebtRepaymentCardImpl)
