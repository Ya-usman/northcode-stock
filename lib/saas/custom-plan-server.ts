// Offre sur mesure — écritures SERVEUR (client admin) : lien de paiement, activation après paiement, retour à une
// formule normale. Règles : lib/saas/custom-plan.

import { randomBytes } from 'crypto'
import { PRICE_GUARANTEE_DAYS, addDays } from './custom-plan'

/** Lien de paiement d'un devis : aléatoire, sans information exploitable */
export function newQuoteToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Devis payé : limites du devis posées sur l'entreprise (formule Business déjà écrite par l'appelant), options remises
 * à zéro (comprises dans le devis) ; premier paiement : devis « payé », prix garanti 1 an ; renouvellement : référence
 * du dernier paiement seulement.
 */
export async function applyCustomPlan(admin: any, entityId: string, quoteId: string, paymentReference: string, now = new Date()): Promise<{ ok: boolean; first: boolean }> {
  const { data: q } = await admin.from('custom_quotes').select('id, status, limit_shops, limit_seats').eq('id', quoteId).maybeSingle()
  if (!q) return { ok: false, first: false }
  const { error } = await admin.from('entities').update({
    custom_shops: q.limit_shops, custom_seats: q.limit_seats, custom_quote_id: q.id,
    addon_seats: 0, addon_shops: 0, addon_seats_renew: null, addon_shops_renew: null,
  }).eq('id', entityId)
  if (error) { console.error('[custom-plan] limites non enregistrées', entityId, error.message); return { ok: false, first: false } }
  const first = q.status !== 'paid'
  await admin.from('custom_quotes').update(first
    ? { status: 'paid', paid_at: now.toISOString(), price_until: addDays(now, PRICE_GUARANTEE_DAYS).toISOString(), payment_reference: paymentReference, updated_at: now.toISOString() }
    : { payment_reference: paymentReference, updated_at: now.toISOString() }).eq('id', q.id)
  return { ok: true, first }
}

/** Paiement d'une formule NORMALE : l'offre sur mesure éventuelle prend fin (limites retirées) */
export async function clearCustomPlan(admin: any, entityId: string): Promise<void> {
  // Sans condition : sans effet si l'entreprise n'avait pas d'offre ; colonnes absentes (211 non appliquée) : erreur ignorée
  const { error } = await admin.from('entities').update({ custom_shops: null, custom_seats: null, custom_quote_id: null }).eq('id', entityId)
  if (error && !/custom_/.test(String(error.message))) console.error('[custom-plan] offre sur mesure non retirée', entityId, error.message)
}
