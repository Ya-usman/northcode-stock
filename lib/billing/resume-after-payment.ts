'use client'

// Retour après le paiement d'une option achetée au moment d'un blocage (tarification du 3 nov. 2026, étape 2 lot 2) :
// avant d'aller chez la passerelle, on garde la page de départ et la saisie en cours (onglet courant seulement,
// sessionStorage) ; au retour réussi sur la page Abonnement, le client est ramené là où il était, la saisie remise.
// Jamais de donnée sensible ici (nom, e-mail de la personne invitée, nom de boutique) ; chaque clé est effacée à la
// lecture ; 1 h au plus.

const RETURN_KEY = 'stockshop:resume-return'
const DRAFT_KEY = 'stockshop:resume-draft'
const MAX_AGE = 3600_000

export type ResumeDraft =
  | { kind: 'invite'; shopId?: string; fullName?: string; email?: string; role?: string }
  | { kind: 'shop'; name?: string; city?: string }

function put(key: string, value: unknown) { try { sessionStorage.setItem(key, JSON.stringify({ value, at: Date.now() })) } catch {} }
function take(key: string): unknown {
  try {
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const s = JSON.parse(raw || 'null')
    return s && Date.now() - Number(s.at) <= MAX_AGE ? s.value : null
  } catch { return null }
}

/** Avant d'aller payer : page où revenir (chemin de l'application) et saisie en cours */
export function saveResume(returnTo: string, draft?: ResumeDraft) {
  put(RETURN_KEY, returnTo)
  if (draft) put(DRAFT_KEY, draft); else { try { sessionStorage.removeItem(DRAFT_KEY) } catch {} }
}

/** Au retour réussi : page où revenir (une seule fois), null sinon */
export function takeReturn(): string | null {
  const v = take(RETURN_KEY)
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : null
}

/** Saisie gardée pour ce formulaire (une seule fois) */
export function takeDraft<K extends ResumeDraft['kind']>(kind: K): Extract<ResumeDraft, { kind: K }> | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')
    if (!raw || raw.value?.kind !== kind) return null
  } catch { return null }
  return take(DRAFT_KEY) as Extract<ResumeDraft, { kind: K }> | null
}
