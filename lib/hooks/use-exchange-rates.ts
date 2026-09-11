'use client'

import { useEffect, useState } from 'react'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { RateMap } from '@/lib/saas/exchange'

/** Taux de change courants (admin, tout niveau) — un seul fetch par page,
 *  consommé par tout composant qui convertit un total pour le reporting
 *  (voir lib/saas/exchange.ts:convertByCurrency). */
export function useExchangeRates() {
  const [rates, setRates] = useState<RateMap>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    withTimeout(fetch('/api/admin/exchange-rates'))
      .then(async (r) => { if (r.ok) setRates((await r.json()).rates || {}) })
      .catch(() => { /* le reporting reste en ventilation brute sans taux */ })
      .finally(() => setLoading(false))
  }, [])

  return { rates, loading }
}
