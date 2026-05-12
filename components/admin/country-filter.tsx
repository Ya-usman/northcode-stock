'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COUNTRIES } from '@/lib/saas/countries'

const COUNTRY_OPTIONS = [
  { value: 'all', label: '🌍 Tous les pays' },
  ...Object.entries(COUNTRIES).map(([code, c]) => ({ value: code, label: `${c.flag} ${c.name}` })),
]

export function CountryFilter({ current, availableCountries }: { current: string; availableCountries?: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const set = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete('country')
    else params.set('country', value)
    router.push(`${pathname}?${params.toString()}`)
  }

  const options = availableCountries
    ? [{ value: 'all', label: '🌍 Tous les pays' }, ...availableCountries.map(code => {
        const c = COUNTRIES[code as keyof typeof COUNTRIES]
        return { value: code, label: c ? `${c.flag} ${c.name}` : `🌐 ${code}` }
      })]
    : COUNTRY_OPTIONS

  return (
    <Select value={current} onValueChange={set}>
      <SelectTrigger className="h-8 text-xs w-44 bg-muted border-border">
        <SelectValue placeholder="Pays" />
      </SelectTrigger>
      <SelectContent>
        {options.map(opt => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
