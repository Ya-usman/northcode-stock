'use client'

// Bouton retour d'Android (application Capacitor) : un SEUL écouteur pour toute l'application
// (components/layout/android-back-handler.tsx). Ordre, validé le 30 oct. 2026 :
//   1. une couche est ouverte (panneau, fenêtre, menu déroulant, liste de choix) → elle se ferme, exactement comme
//      avec Échap (confirmation « modifications non enregistrées » comprise) ;
//   2. sinon, un écran qui a ses propres étapes (Caisse : Paiement → Panier → Produits) recule d'une étape ;
//   3. sinon, page précédente ; sur la première page, l'application se ferme (comportement Android habituel).
// Ce fichier tient le registre de l'étape 2 : le gestionnaire inscrit le plus récemment passe en premier ; il
// renvoie true s'il a traité le retour.

type BackHandler = () => boolean
const handlers: BackHandler[] = []

/** Inscrit un gestionnaire de retour (étape 2) ; renvoie la fonction de désinscription */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.lastIndexOf(handler)
    if (i >= 0) handlers.splice(i, 1)
  }
}

/** Étape 2 : le gestionnaire le plus récent qui accepte le retour */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return true
  }
  return false
}

// Couches ouvertes reconnues (Radix : fenêtres, panneaux, menus, listes de choix)
const OPEN_LAYER = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ')

/** Étape 1 : ferme la couche du dessus comme Échap ; false s'il n'y en a aucune */
export function closeTopLayer(): boolean {
  if (typeof document === 'undefined' || !document.querySelector(OPEN_LAYER)) return false
  const target = (document.activeElement as HTMLElement | null) || document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
  return true
}
