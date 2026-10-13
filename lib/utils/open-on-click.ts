import type { MouseEvent } from 'react'

// Ligne ou carte « ouvrable » : un toucher n'importe où dans une zone neutre
// ouvre la fiche ; un toucher sur un bouton, un lien, une case, un menu ne
// fait QUE son action. Plutôt que de demander à chaque bouton d'arrêter la
// propagation (un oubli ouvrirait la fiche par erreur), c'est la ligne qui
// ignore tout clic né dans un élément interactif — y compris ceux d'un menu
// déroulant, dont les clics remontent jusqu'à la ligne bien qu'ils soient
// affichés ailleurs dans la page.
const INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [role="menu"], [role="menuitem"], [role="checkbox"], [role="dialog"], [data-no-open]'

/** Ce clic doit-il ouvrir la ligne ? Non s'il vient d'un élément interactif ou termine une sélection de texte. */
export function isNeutralClick(e: MouseEvent<HTMLElement>): boolean {
  const target = e.target as HTMLElement | null
  if (!target || typeof target.closest !== 'function') return false
  if (target.closest(INTERACTIVE)) return false
  if (typeof window !== 'undefined' && window.getSelection && String(window.getSelection() || '').trim()) return false
  return true
}
