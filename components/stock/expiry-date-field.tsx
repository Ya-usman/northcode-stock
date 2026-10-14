'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { localToday } from '@/lib/stock/signals'
import { cn } from '@/lib/utils/cn'

// Saisie de la date de péremption d'une ENTRÉE DE STOCK (le lot qu'elle crée) — UN
// seul champ dans toute l'application : création d'un produit avec du stock,
// réassort, réception fournisseur, modification de la date d'un lot.
// La date appartient au lot, jamais au produit. Elle est facultative (vêtements,
// téléphones… : « Sans date » est un état normal) ; aucune date par défaut,
// aucune durée de vie inventée. Une date passée n'est pas interdite (on peut
// recevoir un produit déjà périmé) : avertissement, puis confirmation à
// l'enregistrement (usePastExpiryConfirm).

/** Date déjà passée, en jours du téléphone (un lot qui périme aujourd'hui n'est pas encore périmé) */
export const isPastExpiry = (value?: string | null, today: string = localToday()): boolean => !!value && value.slice(0, 10) < today

export interface ExpiryDateFieldProps {
  id: string
  value: string | null | undefined
  onChange: (value: string) => void
  /** Ligne compacte (réception fournisseur : un champ par produit) */
  compact?: boolean
  disabled?: boolean
  className?: string
}

export function ExpiryDateField({ id, value, onChange, compact, disabled, className }: ExpiryDateFieldProps) {
  const t = useTranslations('expiry_field')
  const past = isPastExpiry(value)
  const warning = past && (
    <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400" data-expiry-past>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{t('past_inline')}
    </p>
  )
  if (compact) {
    return (
      <div className={cn('space-y-1', className)} data-expiry-field>
        <div className="flex items-center gap-1.5">
          <Label htmlFor={id} className="shrink-0 text-[11px] font-normal text-muted-foreground">
            {t('label')} <span className="opacity-80">· {t('optional')}</span>
          </Label>
          <Input id={id} type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-9 min-w-0 flex-1 text-xs sm:h-8" />
        </div>
        {warning}
      </div>
    )
  }
  return (
    <div className={cn('space-y-1.5', className)} data-expiry-field>
      <Label htmlFor={id} className="flex items-baseline gap-1.5">
        {t('label')}<span className="text-xs font-normal text-muted-foreground">{t('optional')}</span>
      </Label>
      <Input id={id} type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} className="h-11 sm:h-10" />
      {warning}
    </div>
  )
}

/**
 * Confirmation à l'enregistrement quand une date saisie est déjà passée :
 *   const pastExpiry = usePastExpiryConfirm()
 *   if (!(await pastExpiry.confirm([date]))) return
 *   … puis rendre {pastExpiry.dialog}
 */
export function usePastExpiryConfirm() {
  const t = useTranslations('expiry_field')
  const [open, setOpen] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  const confirm = useCallback((dates: (string | null | undefined)[]): Promise<boolean> => {
    if (!dates.some(d => isPastExpiry(d))) return Promise.resolve(true)
    return new Promise<boolean>(resolve => { resolver.current = resolve; setOpen(true) })
  }, [])
  const settle = (ok: boolean) => {
    setOpen(false)
    resolver.current?.(ok)
    resolver.current = null
  }
  const dialog = (
    <ConfirmModal
      open={open}
      onOpenChange={o => { if (!o) settle(false) }}
      title={t('confirm_title')}
      description={t('confirm_desc')}
      icon={<AlertTriangle className="h-4 w-4" />}
      confirmLabel={t('confirm_action')}
      onConfirm={() => settle(true)}
    />
  )
  return { confirm, dialog }
}
