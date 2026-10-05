// Expéditeur UNIQUE de tous les e-mails StockShop (domaine stockshop.tech
// vérifié chez Resend). Ne jamais réintroduire `onboarding@resend.dev` :
// c'est l'adresse de test de Resend, qui n'écrit qu'au titulaire du compte.
export const EMAIL_FROM = 'StockShop <no-reply@stockshop.tech>'

/** Adresse publique de l'application (liens dans les e-mails) */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://stockshop.tech').replace(/\/+$/, '')
}
