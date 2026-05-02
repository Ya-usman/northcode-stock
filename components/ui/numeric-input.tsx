'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: number | string
  onChange?: (value: number) => void
}

export function NumericInput({ value = 0, onChange, onBlur, className, ...props }: NumericInputProps) {
  const [focused, setFocused] = useState(false)

  const numValue =
    typeof value === 'string'
      ? parseFloat(value.replace(/\s/g, '').replace(',', '.')) || 0
      : (value ?? 0)

  const display = focused
    ? numValue === 0 ? '' : String(numValue)
    : numValue === 0 ? '' : numValue.toLocaleString('fr-FR')

  return (
    <input
      type="text"
      inputMode="decimal"
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
        const raw = e.target.value.replace(/[^\d.,]/g, '').replace(',', '.')
        onChange?.(parseFloat(raw) || 0)
      }}
      onFocus={() => setFocused(true)}
      onBlur={e => {
        setFocused(false)
        ;(onBlur as any)?.(e)
      }}
      {...props}
    />
  )
}
