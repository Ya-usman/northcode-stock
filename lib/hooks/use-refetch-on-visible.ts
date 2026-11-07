'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ensureFreshSession } from '@/lib/session-refresh'

const supabase = createClient()

/**
 * Refetch when the tab regains visibility after sitting hidden/idle a
 * while — the moment a stale JWT is most likely to bite (background
 * refresh timers are throttled while the tab is hidden). Without this, a
 * refetch fired right on visibilitychange can race a page's own local
 * session-refresh attempt (or find none at all) and hit RLS with an
 * invalid session, which returns 0 rows rather than an error — a filter
 * or list silently looking empty until a hard reload.
 *
 * Waits for ensureFreshSession() (shared/deduplicated across every caller)
 * before invoking fetchFn, instead of firing independently and racing it.
 * fetchFn is read from a ref, so callers don't need a dependency array —
 * the latest closure is always used without resubscribing the listener.
 */
// Absence minimale avant de relire (7 nov. 2026, état des lieux de la montée en charge) : sur téléphone, chaque passage
// par une autre application (WhatsApp, appel) relisait le catalogue, les clients ou les rapports en entier. Un retour
// après moins d'une minute garde l'écran tel quel ; le temps réel et les actions de la page le tiennent à jour.
const MIN_HIDDEN_MS = 60_000

export function useRefetchOnVisible(fetchFn: () => void) {
  const fetchRef = useRef(fetchFn)
  fetchRef.current = fetchFn

  useEffect(() => {
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null
    const onVisible = () => {
      if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return }
      const away = hiddenAt === null ? Infinity : Date.now() - hiddenAt
      hiddenAt = null
      if (away < MIN_HIDDEN_MS) return
      ensureFreshSession(supabase).then(() => fetchRef.current())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
}
