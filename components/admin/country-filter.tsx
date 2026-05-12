'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

const COUNTRIES = [
  { value: 'all', label: '🌍 Tous les pays' },
  { value: 'NG', label: '🇳🇬 Nigeria' },
  { value: 'CM', label: '🇨🇲 Cameroun' },
] as const

export function CountryFilter({ current }: { current: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const set = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete('country')
    else params.set('country', value)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-foreground/70 font-medium">Pays :</span>
      {COUNTRIES.map(c => (
        <button
          key={c.value}
          onClick={() => set(c.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            current === c.value || (c.value === 'all' && current === 'all')
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-foreground/60 border border-border hover:text-foreground hover:border-foreground/30'
          }`}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}
