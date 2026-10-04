'use client'

import { useCallback, useSyncExternalStore } from 'react'

// Vue de la liste des produits (page Stock) : cartes ou tableau. Choix
// mémorisé sur l'appareil ; au premier passage, tableau dès qu'il y a la
// place (tablette, ordinateur), cartes sur téléphone.
// useSyncExternalStore : le rendu serveur n'a pas accès au stockage, React
// hydrate avec « cartes » puis applique le choix réel avant la peinture, sans
// avertissement d'hydratation ni clignotement.

export type StockViewMode = 'cards' | 'table'

const KEY = 'stock_view_mode'
const listeners = new Set<() => void>()
// Dernier choix de la session, pour que la bascule marche même sans stockage
let sessionChoice: StockViewMode | null = null

function read(): StockViewMode {
  if (sessionChoice) return sessionChoice
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'cards' || stored === 'table') return stored
  } catch { /* stockage indisponible : valeur par défaut */ }
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 640px)').matches ? 'table' : 'cards'
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useStockViewMode(): [StockViewMode, (mode: StockViewMode) => void] {
  const mode = useSyncExternalStore(subscribe, read, () => 'cards' as StockViewMode)
  const setMode = useCallback((next: StockViewMode) => {
    sessionChoice = next
    try { localStorage.setItem(KEY, next) } catch { /* sans stockage, le choix vaut pour la session */ }
    listeners.forEach(l => l())
  }, [])
  return [mode, setMode]
}
