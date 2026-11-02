'use client'

// Mention courte avec son explication, lisible au doigt comme à la souris (lot « simplicité » n° 2, 2 nov. 2026) :
// avant, « 3 périmés » ou « 2 réservés » ne s'expliquaient qu'au survol (title=), invisible sur téléphone.
// Un appui ouvre une petite bulle avec la phrase, et au besoin l'action qui va avec (« Voir les lots ») ; il n'ouvre
// jamais la carte ou la ligne qui la contient.

import { useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils/cn'

interface Props {
  label: React.ReactNode
  hint: string
  /** Action proposée sous l'explication (ex. « Voir les lots ») */
  action?: { label: string; onClick: () => void }
  className?: string
  testId?: string
}

export function TapHint({ label, hint, action, className, testId }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" title={hint} data-testid={testId} data-no-open
          onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
          className={cn('rounded underline decoration-dotted underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-2 p-3 text-xs leading-relaxed" onClick={e => e.stopPropagation()}>
        <p data-testid={testId ? `${testId}-text` : undefined}>{hint}</p>
        {action && (
          <button type="button" data-testid={testId ? `${testId}-action` : undefined}
            onClick={() => { setOpen(false); action.onClick() }}
            className="text-xs font-semibold text-stockshop-blue hover:underline dark:text-blue-400">
            {action.label}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
