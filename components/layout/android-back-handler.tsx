'use client'

import { useEffect } from 'react'
import { isCapacitor } from '@/lib/utils/native-share'
import { closeTopLayer, runBackHandlers } from '@/lib/navigation/back-handlers'

// Bouton retour d'Android : ferme d'abord la couche ouverte (panneau, fenêtre, menu), puis laisse un écran à étapes
// reculer (Caisse), sinon revient à la page précédente ; sur la première page, ferme l'application.
// Règles : lib/navigation/back-handlers.ts. Inscrire un écouteur « backButton » supprime le comportement natif de
// Capacitor : la dernière étape le reproduit (page précédente si possible, sinon sortie).
export function AndroidBackHandler() {
  useEffect(() => {
    if (!isCapacitor()) return
    let cancelled = false
    let remove: (() => void) | undefined
    import('@capacitor/app').then(({ App }) =>
      App.addListener('backButton', ({ canGoBack }) => {
        if (closeTopLayer()) return
        if (runBackHandlers()) return
        if (canGoBack) window.history.back()
        else App.exitApp()
      }).then(h => { if (cancelled) h.remove(); else remove = () => { h.remove() } }),
    ).catch(() => {})
    return () => { cancelled = true; remove?.() }
  }, [])
  return null
}
