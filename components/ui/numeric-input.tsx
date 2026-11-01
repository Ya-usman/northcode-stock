'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { displayMetaFor } from '@/lib/saas/currencies'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: number | string | null
  onChange?: (value: number) => void
  currency?: string
  /** Case vide distincte de 0 (seuil d'alerte : vide = seuil de la boutique, 0 = pas d'alerte) : la valeur vide
   *  est rendue par onChange(null) et 0 s'affiche « 0 » */
  allowEmpty?: boolean
}

function fmt(n: number, currency?: string): string {
  if (!n) return ''
  // Sépare seulement les milliers (pas de symbole) — locale du registre
  // central (code ISO ou ancien symbole tolérés).
  const locale = currency ? displayMetaFor(currency).numberLocale : 'en-NG'
  return n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function NumericInput({ allowEmpty, ...rest }: NumericInputProps) {
  return allowEmpty ? <OptionalNumericInput {...rest} /> : <RequiredNumericInput {...rest} />
}

function OptionalNumericInput({ value, onChange, onBlur, className, currency, ...props }: Omit<NumericInputProps, 'allowEmpty'>) {
  const toText = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '' : String(Math.trunc(Number(v))))
  const [display, setDisplay] = useState(toText(value))
  const prev = useRef(toText(value))
  useEffect(() => {
    const next = toText(value)
    if (next !== prev.current) { prev.current = next; setDisplay(next) }
  }, [value])
  return (
    <input
      type="text"
      inputMode="numeric"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'tabular-nums',
        className
      )}
      value={display}
      onChange={e => {
        const digits = e.target.value.replace(/\D/g, '')
        prev.current = digits === '' ? '' : String(parseInt(digits, 10))
        setDisplay(prev.current)
        onChange?.((digits === '' ? null : parseInt(digits, 10)) as unknown as number)
      }}
      onBlur={onBlur}
      {...props}
    />
  )
}

function RequiredNumericInput({ value = 0, onChange, onBlur, className, currency, ...props }: Omit<NumericInputProps, 'allowEmpty'>) {
  const numValue =
    typeof value === 'string'
      ? parseInt(value.replace(/\D/g, ''), 10) || 0
      : (value ?? 0)

  const [display, setDisplay] = useState(fmt(numValue, currency))
  const prev = useRef(numValue)

  // Sync when external value changes (e.g. form reset)
  useEffect(() => {
    if (numValue !== prev.current) {
      prev.current = numValue
      setDisplay(fmt(numValue, currency))
    }
  }, [numValue, currency])

  return (
    <input
      type="text"
      inputMode="numeric"
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'tabular-nums',
        className
      )}
      value={display}
      onChange={e => {
        const digits = e.target.value.replace(/\D/g, '')
        const num = parseInt(digits, 10) || 0
        prev.current = num
        setDisplay(digits === '' ? '' : fmt(num, currency))
        onChange?.(num)
      }}
      onBlur={e => {
        const num = parseInt(display.replace(/\D/g, ''), 10) || 0
        prev.current = num
        setDisplay(fmt(num, currency))
        ;(onBlur as any)?.(e)
      }}
      {...props}
    />
  )
}
