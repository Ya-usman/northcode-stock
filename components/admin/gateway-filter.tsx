'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Libellé + couleur par fournisseur de paiement — utilisé à la fois par le
// filtre ci-dessous et par les badges de la page Facturation. 'legacy' =
// lignes créées avant la colonne `gateway` (migration 071), toutes via
// Paystack à l'époque (seul fournisseur existant alors).
export const GATEWAY_LABELS: Record<string, { name: string; color: string }> = {
  paystack:    { name: 'Paystack',    color: 'text-blue-400 bg-blue-400/10' },
  flutterwave: { name: 'Flutterwave', color: 'text-orange-400 bg-orange-400/10' },
  wave:        { name: 'Wave',        color: 'text-cyan-400 bg-cyan-400/10' },
  notchpay:    { name: 'NotchPay',    color: 'text-purple-400 bg-purple-400/10' },
  stripe:      { name: 'Stripe',      color: 'text-indigo-400 bg-indigo-400/10' },
  legacy:      { name: 'Paystack (historique)', color: 'text-muted-foreground bg-muted' },
}

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
