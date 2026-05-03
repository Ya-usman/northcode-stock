'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: number | string
  onChange?: (value: number) => void
}

function fmt(n: number): string {
  if (!n) return ''
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export function NumericInput({ value = 0, onChange, onBlur, className, ...props }: NumericInputProps) {
  const numValue =
    typeof value === 'string'
      ? parseInt(value.replace(/\D/g, ''), 10) || 0
      : (value ?? 0)

  const [display, setDisplay] = useState(fmt(numValue))
  const prev = useRef(numValue)

  // Sync when external value changes (e.g. form reset)
  useEffect(() => {
    if (numValue !== prev.current) {
      prev.current = numValue
      setDisplay(fmt(numValue))
    }
  }, [numValue])

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
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
        setDisplay(digits === '' ? '' : fmt(num))
        onChange?.(num)
      }}
      onBlur={e => {
        const num = parseInt(display.replace(/\D/g, ''), 10) || 0
        prev.current = num
        setDisplay(fmt(num))
        ;(onBlur as any)?.(e)
      }}
      {...props}
    />
  )
}
