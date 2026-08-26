'use client'

import { useEffect, useState } from 'react'

// Filet de sécurité local pour les pages dont le chargement dépend de
// effectiveShopIds (auth-context.tsx). Ce contexte borne déjà chaque
// tentative de fetchUserData dans le temps, mais si le réseau reste
// indisponible au-delà de sa fenêtre de nouvelles tentatives en
// arrière-plan (120s), effectiveShopIds ne se remplit jamais — sans ce
// hook, la page resterait bloquée indéfiniment sur son skeleton, sans
// retry ni message d'erreur visible.
export function useShopLoadTimeout(effectiveShopIdsLength: number, timeoutMs = 15000): boolean {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (effectiveShopIdsLength > 0) {
      setTimedOut(false)
      return
    }
    const timer = setTimeout(() => setTimedOut(true), timeoutMs)
    return () => clearTimeout(timer)
  }, [effectiveShopIdsLength, timeoutMs])

  return timedOut
}
