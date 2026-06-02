'use client'

import { CloudOff } from 'lucide-react'

interface Props {
  ageMs: number | null
  isOnline: boolean
}

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'à l\'instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  return `il y a ${Math.floor(hours / 24)}j`
}

export function CacheBanner({ ageMs, isOnline }: Props) {
  if (isOnline || ageMs === null) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400">
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span>Données en cache · {formatAge(ageMs)}</span>
    </div>
  )
}
