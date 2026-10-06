'use client'

// Formulaire des horaires d'ouverture — UN SEUL composant pour Paramètres et
// la fiche boutique → Horaires (phase 3, lot 3B). Contrôlé : la page garde
// l'état et décide quand enregistrer (/api/shops/settings, propriétaire).

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils/cn'

export type HoursOverride = 'auto' | 'open' | 'closed'
export interface ShopHoursValue {
  enabled: boolean
  opening: string
  closing: string
  override: HoursOverride
}

export const hoursValueOf = (s: { hours_enabled?: boolean | null; opening_time?: string | null; closing_time?: string | null; hours_manual_override?: string | null }): ShopHoursValue => ({
  enabled: !!s.hours_enabled,
  opening: (s.opening_time || '08:00').slice(0, 5),
  closing: (s.closing_time || '20:00').slice(0, 5),
  override: s.hours_manual_override === 'open' ? 'open' : s.hours_manual_override === 'closed' ? 'closed' : 'auto',
})

/** Champs envoyés à /api/shops/settings */
export const hoursPayload = (v: ShopHoursValue) => ({
  hours_enabled: v.enabled,
  opening_time: v.opening,
  closing_time: v.closing,
  hours_manual_override: v.override === 'auto' ? null : v.override,
})

export const hoursRangeInvalid = (v: ShopHoursValue) => v.enabled && v.closing <= v.opening

export function ShopHoursEditor({ value, onChange, disabled = false }: { value: ShopHoursValue; onChange: (v: ShopHoursValue) => void; disabled?: boolean }) {
  const t = useTranslations('settings')
  const set = (patch: Partial<ShopHoursValue>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-4" data-testid="hours-editor">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="hours-enabled">{t('hours_enabled')}</Label>
        <Switch id="hours-enabled" checked={value.enabled} onCheckedChange={v => set({ enabled: v })} disabled={disabled} />
      </div>

      {value.enabled && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="hours-opening">{t('hours_opening')}</Label>
              <Input id="hours-opening" type="time" value={value.opening} onChange={e => set({ opening: e.target.value })} disabled={disabled} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hours-closing">{t('hours_closing')}</Label>
              <Input id="hours-closing" type="time" value={value.closing} onChange={e => set({ closing: e.target.value })} disabled={disabled}
                aria-invalid={hoursRangeInvalid(value)} className={cn(hoursRangeInvalid(value) && 'border-red-400 focus-visible:ring-red-400')} />
            </div>
          </div>
          {hoursRangeInvalid(value) && <p className="text-xs text-red-600 dark:text-red-400">{t('hours_invalid_range')}</p>}

          <div className="space-y-1.5">
            <Label>{t('hours_override')}</Label>
            <div className="flex flex-wrap gap-2">
              {([
                ['auto', t('hours_override_auto')],
                ['open', t('hours_override_open')],
                ['closed', t('hours_override_closed')],
              ] as const).map(([v, label]) => (
                <button key={v} type="button" disabled={disabled} onClick={() => set({ override: v })} aria-pressed={value.override === v}
                  className={cn('rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                    value.override === v ? 'border-stockshop-blue bg-stockshop-blue text-white dark:border-blue-500' : 'border-border text-muted-foreground hover:bg-muted')}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {value.override !== 'auto' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
              {t('hours_override_warning')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
