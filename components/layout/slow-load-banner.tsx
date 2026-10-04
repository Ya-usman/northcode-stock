'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useAuthContext } from '@/lib/contexts/auth-context'

// Session connue mais profil / boutiques pas encore arrivés depuis plus de
// 4 s (cache local absent + Supabase lent) : l'app est déjà ouverte (budget de
// première peinture, voir auth-context) ; ce bandeau dit que ça travaille
// encore et permet de relancer, au lieu d'un squelette muet.
export function SlowLoadBanner() {
  const t = useTranslations('banners')
  const { user, profile, loading, refreshShop } = useAuthContext()
  const [slow, setSlow] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const waiting = !!user && !profile && !loading

  useEffect(() => {
    if (!waiting) { setSlow(false); return }
    const timer = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(timer)
  }, [waiting])

  if (!waiting || !slow) return null

  const retry = async () => {
    setRetrying(true)
    try { await refreshShop() } finally { setRetrying(false) }
  }

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="min-w-0 flex-1">{t('slow_load_title')} · {t('slow_load_body')}</span>
      <button type="button" onClick={retry} disabled={retrying}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500/15 px-2.5 py-1 hover:bg-amber-500/25 disabled:opacity-50">
        <RefreshCw className={retrying ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
        {t('slow_load_retry')}
      </button>
    </div>
  )
}
