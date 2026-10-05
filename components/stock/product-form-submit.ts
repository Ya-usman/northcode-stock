// Pont entre le pied du panneau (FormDrawer) et le formulaire produit chargé à
// la demande : identifiant du <form> et état remonté. Module minuscule et sans
// React, pour que la page n'embarque pas le formulaire dans son premier
// chargement.

export const PRODUCT_FORM_ID = 'product-form'

export interface ProductFormState {
  /** Saisie modifiée et non enregistrée (garde de fermeture) */
  dirty: boolean
  /** Téléversement de photo en cours : enregistrement interdit */
  busy: boolean
}
