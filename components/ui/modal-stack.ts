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

// 3. Retour (flèche du téléphone, du navigateur ou de l'application installée, 1er nov. 2026) : chaque couche
//    ouverte ajoute une étape à l'historique (même adresse) ; un retour ferme la couche du dessus au lieu de
//    quitter la page (avant : depuis la fiche d'un produit, le retour ramenait à la Vue d'ensemble du stock).
//    L'étape est remise aussitôt puis retirée seulement quand la couche se ferme vraiment : avec une saisie non
//    enregistrée, la confirmation s'affiche et « Continuer » garde la couche ET son étape. Fermer par la croix,
//    Échap ou une action retire l'étape (aucun appui « dans le vide » ensuite).

interface Entry {
  close: () => void
  element: () => HTMLElement | null
  /** Panneau latéral (AppDrawer) ou fenêtre / liste */
  kind: 'drawer' | 'other'
  /** Étape d'historique de cette couche */
  historyId: number
}

const stack: Entry[] = []
let historySeq = 0
// Retours déclenchés par nous-mêmes (retrait de l'étape d'une couche fermée) : ignorés par l'écouteur
let ownPops = 0
let listening = false

const layerState = (id: number) => ({ ...(window.history.state || {}), __layer: id })

/** Retire l'étape courante si elle n'appartient plus à aucune couche ouverte (couche fermée, ou fermée par une
 *  navigation vers une autre page puis retour), une étape à la fois */
function sweep() {
  try {
    const s = window.history.state
    if (s && typeof s.__layer === 'number' && !stack.some(e => e.historyId === s.__layer)) { ownPops++; window.history.back() }
  } catch {}
}

function onPopState() {
  if (ownPops > 0) { ownPops--; setTimeout(sweep, 0); return }
  const top = stack[stack.length - 1]
  if (top) {
    // Étape remise tout de suite : elle ne sera retirée qu'à la fermeture effective de la couche
    try { window.history.pushState(layerState(top.historyId), '', window.location.href) } catch {}
    top.close()
    return
  }
  sweep()
}

function ensureListener() {
  if (listening || typeof window === 'undefined') return
  window.addEventListener('popstate', onPopState)
  listening = true
}

/** Ferme le panneau ou la fenêtre du dessus (avec la confirmation « modifications non enregistrées » s'il y a lieu) */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top.close()
  return true
}

/** Nombre de panneaux latéraux ouverts (un panneau qui s'ouvre par-dessus un autre affiche la flèche retour) */
export function openDrawerCount(): number {
  return stack.filter(e => e.kind === 'drawer').length
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
export function useModalStack(open: boolean, requestClose: () => void, contentRef: RefObject<HTMLElement>, kind: Entry['kind'] = 'other'): void {
  const closeRef = useRef(requestClose)
  closeRef.current = requestClose
  useEffect(() => {
    if (!open) return
    const entry: Entry = { close: () => closeRef.current(), element: () => contentRef.current, kind, historyId: ++historySeq }
    stack.push(entry)
    ensureListener()
    try { window.history.pushState(layerState(entry.historyId), '', window.location.href) } catch {}
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
      // Fermeture effective : l'étape de cette couche est retirée (après le rendu, pour qu'une couche ouverte dans
      // le même geste garde la sienne ; rien après une navigation vers une autre page)
      setTimeout(sweep, 0)
    }
  }, [open, contentRef, kind])
}
