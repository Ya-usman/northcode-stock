// Protection de l'essai gratuit (tarification, étape 4A-2a, décisions du 4 nov. 2026) — RÈGLE UNIQUE, fonctions pures.
//
//   • 1 numéro de téléphone = 1 essai sur 12 mois : un numéro qui a déjà eu un essai accordé il y a moins de 12 mois
//     (autre entreprise, compte supprimé compris) → compte créé SANS essai ;
//   • même appareil ou même « nom + ville » qu'un essai récent → SIGNALÉ à l'administration, jamais bloqué
//     (un téléphone est souvent partagé dans une famille ou une boutique) ;
//   • le numéro est contrôlé selon le format réel du pays (libphonenumber), au format international E.164.
// Registre : table trial_claims (migration 213), empreintes seulement (lib/saas/trial-claim-server).

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'

export const TRIAL_DAYS = 30
export const CLAIM_WINDOW_DAYS = 365
const DAY = 86_400_000

export type TrialFlag = 'phone_reused' | 'same_device' | 'same_name_city'
export type TrialStatus = 'granted' | 'refused' | 'pending_phone'

/** Numéro au format international E.164 (« +237690123456 »), ou null s'il n'est pas valide pour le pays */
export function normalizePhone(raw: string | null | undefined, country?: string | null): string | null {
  const s = String(raw || '').trim()
  if (!s || s.length > 32) return null
  try {
    const p = parsePhoneNumberFromString(s, (country || undefined) as CountryCode | undefined)
    return p && p.isValid() ? p.number : null
  } catch { return null }
}

/** Clé « nom + ville » (minuscules, sans accents ni ponctuation) ; null si l'un manque */
export function nameCityKey(name: string | null | undefined, city: string | null | undefined): string | null {
  const f = (v: string | null | undefined) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const n = f(name), c = f(city)
  return n.length >= 3 && c.length >= 2 ? `${n}|${c}` : null
}

export interface PriorClaim { entity_id: string | null; granted: boolean; created_at: string }

/** Essais du registre qui comptent : accordés, il y a moins de 12 mois, à une AUTRE entreprise */
export function recentOthers(claims: PriorClaim[], entityId: string | null, now = new Date()): PriorClaim[] {
  const since = now.getTime() - CLAIM_WINDOW_DAYS * DAY
  return claims.filter(c => c.granted && new Date(c.created_at).getTime() >= since && (!entityId || c.entity_id !== entityId))
}

/**
 * Décision : `phone` = essais passés du même numéro, `device` = du même appareil, `nameCity` = même nom + ville.
 * Refus seulement sur le numéro ; appareil et nom + ville → signalements.
 */
export function decideTrial(
  prior: { phone: PriorClaim[]; device: PriorClaim[]; nameCity: PriorClaim[] }, entityId: string | null, now = new Date(),
): { granted: boolean; flags: TrialFlag[]; previousAt: string | null } {
  const phone = recentOthers(prior.phone, entityId, now)
  const flags: TrialFlag[] = []
  if (phone.length) flags.push('phone_reused')
  if (recentOthers(prior.device, entityId, now).length) flags.push('same_device')
  if (recentOthers(prior.nameCity, entityId, now).length) flags.push('same_name_city')
  const previousAt = phone.map(c => c.created_at).sort().pop() ?? null
  return { granted: phone.length === 0, flags, previousAt }
}

/** Fin de l'essai accordé maintenant */
export function trialEnd(now = new Date()): string {
  return new Date(now.getTime() + TRIAL_DAYS * DAY).toISOString()
}

/** Identifiant d'appareil envoyé par l'écran : jeton aléatoire raisonnable, sinon ignoré */
export function cleanDeviceId(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : null
}
