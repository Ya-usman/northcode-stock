'use client'

// Champ « Fuseau horaire » d'une boutique (migration 178) — création, Paramètres, administration.
//   • pays à fuseau unique : fuseau affiché en lecture seule (aucun choix à faire) ;
//   • pays à plusieurs fuseaux (US, CA, CD, ES, PT) : liste humaine (« Heure de Chicago (GMT-5) »),
//     fuseau de l'appareil proposé s'il appartient au pays ; la valeur enregistrée est toujours l'identifiant IANA.
// Le serveur et la base revérifient tout (cohérence pays ↔ fuseau).
import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Clock } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { deviceTimeZone, isMultiTimeZoneCountry, isTimeZoneOfCountry, suggestTimeZone, zoneLabel, zoneOptions } from '@/lib/time/time-zones'

/** Valeur initiale / après changement de pays : l'actuelle si elle reste valable, sinon la proposition */
export function timeZoneForCountry(country: string | null | undefined, current?: string | null): string | null {
  return current && isTimeZoneOfCountry(current, country) ? current : suggestTimeZone(country)
}

/** Erreur de saisie : fuseau manquant (pays à plusieurs fuseaux) ou incohérent */
export function timeZoneError(country: string | null | undefined, value: string | null | undefined): 'required' | 'invalid' | null {
  if (!value) return isMultiTimeZoneCountry(country) ? 'required' : null
  return isTimeZoneOfCountry(value, country) ? null : 'invalid'
}

export function TimeZoneField({ id = 'shop-timezone', country, value, onChange, disabled, error }: {
  id?: string
  country: string | null | undefined
  value: string | null | undefined
  onChange: (tz: string) => void
  disabled?: boolean
  error?: string | null
}) {
  const t = useTranslations('time_zone')
  const locale = useLocale()
  const multi = isMultiTimeZoneCountry(country)
  const options = useMemo(() => zoneOptions(country, locale, [value, deviceTimeZone()]), [country, locale, value])

  return (
    <div className="space-y-1.5" data-testid="time-zone-field">
      <Label htmlFor={id}>{t('label')}</Label>
      {multi ? (
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger id={id} className="h-10" aria-invalid={!!error} data-testid="time-zone-select">
            <SelectValue placeholder={t('choose')} />
          </SelectTrigger>
          <SelectContent>
            {options.map(o => (
              <SelectItem key={o.value} value={o.value}>
                <span>{o.label}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{o.value}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p id={id} className="flex h-10 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm" data-testid="time-zone-readonly">
          <Clock className="h-4 w-4 text-muted-foreground" />
          {value ? zoneLabel(value, locale) : '—'}
        </p>
      )}
      {error
        ? <p className="text-xs text-destructive">{error}</p>
        : <p className="text-[11px] text-muted-foreground">{multi ? t('hint_multi') : t('hint_single')}</p>}
    </div>
  )
}
