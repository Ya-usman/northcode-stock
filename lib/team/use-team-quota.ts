'use client'

// Quota d'équipe du compte — lu sur /api/team/quota (règle unique serveur :
// lib/saas/team-quota.ts). Aucun comptage côté interface.

import { useCallback, useEffect, useState } from 'react'

/** limit / shops_limit = limites effectives (formule + gestes commerciaux) ; offered = part offerte */
export interface TeamQuota {
  used: number; limit: number; offered?: number; plan: string; planName: string
  shops_limit?: number; shops_offered?: number
}

export function useTeamQuota(shopId: string | null | undefined) {
  const [data, setData] = useState<TeamQuota | null>(null)
  const refresh = useCallback(async () => {
    if (!shopId) { setData(null); return }
    try {
      const res = await fetch(`/api/team/quota?shop_id=${shopId}`)
      if (res.ok) setData(await res.json())
    } catch { /* indicatif seulement */ }
  }, [shopId])
  useEffect(() => { refresh() }, [refresh])
  return { data, refresh }
}
