// Pont entre le pied du panneau (FormDrawer) et le formulaire produit chargé à
// la demande : identifiant du <form>, intention de soumission, état remonté.
// Module minuscule et sans React, pour que la page n'embarque pas le
// formulaire dans son premier chargement.

export const PRODUCT_FORM_ID = 'product-form'
export const PRODUCT_FORM_INTENT_ADD_ANOTHER = 'add_another'

export interface ProductFormState {
  /** Saisie modifiée et non enregistrée (garde de fermeture) */
  dirty: boolean
  /** Téléversement de photo en cours : enregistrement interdit */
  busy: boolean
}

/** Soumet le formulaire produit depuis l'extérieur (validation incluse), avec une intention facultative */
export function requestProductFormSubmit(intent?: string) {
  const el = document.getElementById(PRODUCT_FORM_ID) as HTMLFormElement | null
  if (!el) return
  if (intent) el.dataset.intent = intent
  else delete el.dataset.intent
  el.requestSubmit()
}
