'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  AsYouType, getCountries, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString,
  type CountryCode as PhoneCountry,
} from 'libphonenumber-js/min'
import examples from 'libphonenumber-js/mobile/examples'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { foldAccents } from '@/components/ui/country-select'
import { cn } from '@/lib/utils/cn'

// ════════════════════════════════════════════════════════════════════════
// CHAMP TÉLÉPHONE INTERNATIONAL — StockShop
// ════════════════════════════════════════════════════════════════════════
// Indicatif choisi dans une liste (drapeau + nom localisé + indicatif,
// recherche par nom, code ISO ou chiffres de l'indicatif ; pays des boutiques
// épinglés en tête), numéro national à droite, mis en forme selon le pays à
// la sortie du champ. Coller « +33 6… » bascule le pays tout seul.
// Valeur émise : format international E.164 (« +237612345678 ») ; chaîne
// vide si rien n'est saisi. Validation propre au pays (libphonenumber).
// Ce module embarque les métadonnées de numérotation : l'importer via
// next/dynamic depuis les pages, pour ne le charger qu'à l'usage.

const ALL = getCountries()
const isPhoneCountry = (c: string | null | undefined): c is PhoneCountry => !!c && (ALL as string[]).includes(c)

export const flagOf = (code: string) =>
  String.fromCodePoint(...code.toUpperCase().split('').map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65))

export interface PhoneInputProps {
  value: string | null | undefined
  /** `valid` : numéro vide ou valide pour le pays choisi */
  onChange: (value: string, valid: boolean) => void
  /** Pays par défaut (celui de la boutique) */
  defaultCountry?: string | null
  /** Pays épinglés en tête de liste (pays des boutiques de l'utilisateur) */
  preferredCountries?: (string | null | undefined)[]
  id?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
  /** Aide sous le champ quand le numéro n'est pas valide pour le pays */
  showValidityHint?: boolean
}

function initialState(value: string | null | undefined, fallback: PhoneCountry) {
  const raw = (value || '').trim()
  if (!raw) return { country: fallback, text: '' }
  const parsed = parsePhoneNumberFromString(raw, fallback)
  if (parsed && parsed.country && isPhoneCountry(parsed.country)) return { country: parsed.country, text: parsed.formatNational() }
  if (parsed) return { country: fallback, text: parsed.formatNational() }
  return { country: fallback, text: raw }
}

export function PhoneInput({
  value, onChange, defaultCountry, preferredCountries = [], id, invalid, disabled, className, showValidityHint = true,
}: PhoneInputProps) {
  const t = useTranslations('phone_input')
  const locale = useLocale()
  const fallback: PhoneCountry = isPhoneCountry(defaultCountry) ? defaultCountry : 'NG'
  const [{ country, text }, setState] = useState(() => initialState(value, fallback))
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [touched, setTouched] = useState(false)
  const lastEmitted = useRef<string | null>(null)

  // Valeur remplacée de l'extérieur (réinitialisation du formulaire, autre fiche)
  useEffect(() => {
    if ((value || '') === (lastEmitted.current ?? '')) return
    lastEmitted.current = value || ''
    setState(initialState(value, fallback))
    setTouched(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const names = useMemo(() => {
    let dn: Intl.DisplayNames | null = null
    try { dn = new Intl.DisplayNames([locale, 'en'], { type: 'region' }) } catch { /* ancien moteur */ }
    return (code: string) => dn?.of(code) || code
  }, [locale])

  const evaluate = (c: PhoneCountry, s: string) => {
    const digits = s.replace(/[^\d+]/g, '')
    if (!digits.replace(/\D/g, '')) return { e164: '', valid: true }
    const parsed = parsePhoneNumberFromString(s, c)
    if (parsed) return { e164: parsed.number, valid: parsed.isValid() }
    return { e164: `+${getCountryCallingCode(c)}${digits.replace(/\D/g, '').replace(/^0+/, '')}`, valid: false }
  }

  const emit = (c: PhoneCountry, s: string) => {
    const { e164, valid } = evaluate(c, s)
    lastEmitted.current = e164
    onChange(e164, valid)
  }

  const handleText = (next: string) => {
    // Numéro international collé ou tapé : le pays suit l'indicatif
    if (next.trim().startsWith('+')) {
      const parsed = parsePhoneNumberFromString(next)
      if (parsed?.country && isPhoneCountry(parsed.country)) {
        const national = new AsYouType(parsed.country).input(parsed.nationalNumber)
        setState({ country: parsed.country, text: national })
        emit(parsed.country, national)
        return
      }
    }
    setState({ country, text: next })
    emit(country, next)
  }

  const pickCountry = (c: PhoneCountry) => {
    setState({ country: c, text })
    emit(c, text)
    setOpen(false)
    setSearch('')
  }

  const formatOnBlur = () => {
    setTouched(true)
    const parsed = parsePhoneNumberFromString(text, country)
    if (parsed?.isValid()) setState({ country, text: parsed.formatNational() })
  }

  const pinned = useMemo(() => {
    const seen = new Set<string>()
    return [fallback, ...preferredCountries]
      .filter((c): c is PhoneCountry => isPhoneCountry(c) && !seen.has(c) && !!seen.add(c))
  }, [fallback, preferredCountries])

  const list = useMemo(() => {
    const q = foldAccents(search.trim().replace(/^\+/, ''))
    const rows = ALL.map(c => ({ code: c, name: names(c), dial: getCountryCallingCode(c) }))
    const filtered = q
      ? rows.filter(r => foldAccents(r.name).includes(q) || r.code.toLowerCase() === q || r.dial.startsWith(q))
      : rows
    filtered.sort((a, b) => a.name.localeCompare(b.name, locale))
    if (q) return { pinnedRows: [], rows: filtered }
    return {
      pinnedRows: pinned.map(c => rows.find(r => r.code === c)!).filter(Boolean),
      rows: filtered.filter(r => !pinned.includes(r.code)),
    }
  }, [search, names, locale, pinned])

  const example = useMemo(() => {
    try { return getExampleNumber(country, examples)?.formatNational() || '' } catch { return '' }
  }, [country])

  const { valid } = evaluate(country, text)
  const showInvalid = invalid || (showValidityHint && touched && !valid)

  const Row = ({ code, name, dial }: { code: PhoneCountry; name: string; dial: string }) => (
    <button
      type="button"
      role="option"
      aria-selected={code === country}
      onClick={() => pickCountry(code)}
      className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/60', code === country && 'bg-stockshop-blue-muted dark:bg-blue-950/40')}
    >
      <span className="text-lg leading-none">{flagOf(code)}</span>
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="tabular-nums text-muted-foreground">+{dial}</span>
      {code === country && <Check className="h-4 w-4 text-stockshop-blue dark:text-blue-400" />}
    </button>
  )

  return (
    <div className={className}>
      <div className="flex w-full items-stretch">
        <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setSearch('') }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={t('country_label', { country: names(country) })}
              data-testid="phone-country"
              className={cn(
                'inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-l-md border border-input bg-muted px-2.5 text-sm',
                'hover:bg-accent focus:outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                showInvalid && 'border-destructive',
              )}
            >
              <span className="text-base leading-none">{flagOf(country)}</span>
              <span className="tabular-nums">+{getCountryCallingCode(country)}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0" onOpenAutoFocus={e => e.preventDefault()}>
            <div className="border-b border-border p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t('search_placeholder')}
                  aria-label={t('search_placeholder')}
                  className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div role="listbox" className="max-h-72 overflow-y-auto py-1">
              {list.pinnedRows.map(r => <Row key={`p-${r.code}`} {...r} />)}
              {list.pinnedRows.length > 0 && <div className="my-1 border-t border-border" />}
              {list.rows.map(r => <Row key={r.code} {...r} />)}
              {list.pinnedRows.length + list.rows.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('no_results')}</p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <input
          id={id}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={text}
          disabled={disabled}
          onChange={e => handleText(e.target.value)}
          onBlur={formatOnBlur}
          placeholder={example}
          aria-invalid={showInvalid || undefined}
          className={cn(
            'flex h-10 min-w-0 flex-1 rounded-r-md border border-l-0 border-input bg-background px-3 py-2 text-sm tabular-nums ring-offset-background',
            'placeholder:text-muted-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            showInvalid && 'border-destructive',
          )}
        />
      </div>
      {showValidityHint && touched && !valid && !invalid && (
        <p className="mt-1 text-xs text-destructive">{t('invalid_for_country', { country: names(country) })}</p>
      )}
    </div>
  )
}
