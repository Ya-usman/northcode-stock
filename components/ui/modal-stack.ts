'use client'

import { useEffect, useRef, type RefObject } from 'react'

// ── Pile des panneaux et fenêtres ouverts ──────────────────────────────────
// AppDrawer et PremiumDialog s'y inscrivent tant qu'ils sont ouverts, du plus
// ancien au plus récent. Deux usages :
// 1. Échap : un message de confirmation (toast) est lui aussi une couche qui
//    écoute Échap, et la plus récente gagne. Juste après une action enregistrée
//    depuis un panneau, le premier Échap ne fermait donc que le message. Le
//    message transmet désormais Échap au niveau visible : un seul appui ferme
//    le panneau (ou la fenêtre) du dessus, comme sans message.
// 2. Focus : quand une fenêtre ouverte depuis un panneau se ferme, le focus
//    revient dans ce panneau s'il était retombé sur la page.

interface Entry {
  close: () => void
  element: () => HTMLElement | null
}

const stack: Entry[] = []

/** Ferme le panneau ou la fenêtre du dessus (avec la confirmation « modifications non enregistrées » s'il y a lieu) */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}

/** Remet le focus dans le panneau ou la fenêtre du dessus s'il est tombé en dehors */
export function refocusTopModal(): void {
  requestAnimationFrame(() => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const el = stack[i].element()
      if (!el || !el.isConnected) continue
      if (!el.contains(document.activeElement)) el.focus({ preventScroll: true })
      return
    }
  })
}

/** Inscrit un panneau ou une fenêtre dans la pile tant qu'il est ouvert */
export function useModalStack(open: boolean, requestClose: () => void, contentRef: RefObject<HTMLElement>): void {
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose
  useEffect(() => {
    if (!open) return
    const entry: Entry = { close: () => closeRef.current(), element: () => contentRef.current }
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [open, contentRef])
}
