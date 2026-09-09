'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GATEWAY_LABELS } from '@/lib/saas/gateways'

const GATEWAY_OPTIONS = [
  { value: 'all', label: '💳 Tous les fournisseurs' },
  ...Object.entries(GATEWAY_LABELS).map(([value, { name }]) => ({ value, label: name })),
]

export function GatewayFilter({ current }: { current: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const set = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete('gateway')
    else params.set('gateway', value)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <Select value={current} onValueChange={set}>
      <SelectTrigger className="h-8 text-xs w-48 bg-muted border-border">
        <SelectValue placeholder="Fournisseur" />
      </SelectTrigger>
      <SelectContent>
        {GATEWAY_OPTIONS.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
