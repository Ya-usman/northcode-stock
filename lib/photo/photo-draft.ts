'use client'

// Brouillon de saisie mis de côté avant d'ouvrir l'appareil photo natif
// (application Android). Si le système détruit l'activité pendant que l'app
// caméra est au premier plan, le WebView repart de zéro au retour : le
// brouillon permet de rouvrir le formulaire tel qu'il était, avec la photo que
// Capacitor rejoue via appRestoredResult (voir PhotoRestoreHandler).
// localStorage et non sessionStorage : le WebView recréé n'a plus la session.

export type PhotoDraftKind = 'product' | 'expense'

export interface PhotoDraftInput {
  kind: PhotoDraftKind
  shopId: string
  /** Chemin complet avec la locale, ex. /fr/stock */
  route: string
  /** Valeurs du formulaire, telles quelles */
  values: Record<string, unknown>
  /** Contexte hors formulaire (identifiant en cours d'édition…) */
  meta?: Record<string, unknown>
}

export interface PhotoDraft extends PhotoDraftInput {
  savedAt: number
}

const KEY = 'photo_draft_v1'
// Au-delà, la saisie est considérée abandonnée (l'utilisateur n'est pas revenu)
const TTL_MS = 15 * 60 * 1000

export function savePhotoDraft(input: PhotoDraftInput): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...input, savedAt: Date.now() }))
  } catch {
    // Stockage indisponible : pas de reprise possible, la prise de vue elle-même fonctionne
  }
}

export function readPhotoDraft(): PhotoDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as PhotoDraft
    if (!draft?.kind || !draft.route || typeof draft.savedAt !== 'number') return null
    if (Date.now() - draft.savedAt > TTL_MS) return null
    return draft
  } catch {
    return null
  }
}

export function clearPhotoDraft(): void {
  try { localStorage.removeItem(KEY) } catch { /* rien à faire */ }
}

// ── Remise de la photo restaurée à l'écran concerné ────────────────────────
// Le gestionnaire global dépose ici la photo et le brouillon puis navigue si
// besoin ; l'écran les consomme au montage (s'il n'était pas affiché) ou via
// l'événement (s'il l'était déjà).

export interface RestoredPhoto {
  draft: PhotoDraft
  /** null : la prise de vue a été annulée, seule la saisie est restaurée */
  file: File | null
}

export const PHOTO_RESTORED_EVENT = 'stockshop:photo-restored'

let pending: RestoredPhoto | null = null

export function publishRestoredPhoto(restored: RestoredPhoto): void {
  pending = restored
  window.dispatchEvent(new CustomEvent<RestoredPhoto>(PHOTO_RESTORED_EVENT, { detail: restored }))
}

/** Récupère (une seule fois) la photo en attente pour ce type d'écran. */
export function consumeRestoredPhoto(kind: PhotoDraftKind): RestoredPhoto | null {
  if (!pending || pending.draft.kind !== kind) return null
  const restored = pending
  pending = null
  return restored
}
