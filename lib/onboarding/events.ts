// Signaux d'accompagnement : les écrans annoncent une action RÉELLEMENT faite
// (produit enregistré, article ajouté au panier, vente validée) ; un tour
// guidé en attente de cette action passe à l'étape suivante.

export type OnboardingEvent = 'product_created' | 'cart_item_added' | 'sale_completed' | 'category_created' | 'member_invited' | 'settings_saved'

const NAME = 'stockshop:onboarding'

export function emitOnboarding(event: OnboardingEvent) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(NAME, { detail: event }))
}

export function onOnboarding(handler: (event: OnboardingEvent) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent).detail as OnboardingEvent)
  window.addEventListener(NAME, listener)
  return () => window.removeEventListener(NAME, listener)
}
