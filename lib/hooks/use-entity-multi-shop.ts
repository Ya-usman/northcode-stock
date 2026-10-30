'use client'

import { useEffect, useState } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'

// L'ENTREPRISE a-t-elle plusieurs boutiques ? Vrai tout de suite si la personne en voit plusieurs ; sinon demandé au
// serveur (une personne qui ne gère qu'une boutique reçoit quand même les demandes de transfert des autres).
// Mémorisé pour la session de l'onglet.
const cache: Record<string, boolean> = {}

export function useEntityMultiShop(): boolean {
  const { userShops, shop } = useAuthContext()
  const many = userShops.length > 1
  const shopId = userShops[0]?.id ?? shop?.id ?? null
  const [known, setKnown] = useState<boolean>(() => many || (shopId ? cache[shopId] === true : false))
  useEffect(() => {
    if (many) { setKnown(true); return }
    if (!shopId) return
    if (shopId in cache) { setKnown(cache[shopId]); return }
    let cancelled = false
    fetch(`/api/shops/entity-count?shop_id=${shopId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { const v = !!j && Number(j.count) > 1; cache[shopId] = v; if (!cancelled) setKnown(v) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [many, shopId])
  return many || known
}
