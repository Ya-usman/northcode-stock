// Stock RÉSERVÉ (migration 172) : les articles d'une facture « mise en
// attente » à la caisse restent en rayon mais sortent du stock disponible.
//
//   Disponible = Physique − Périmé − Réservé
//
// La réservation est INDICATIVE : elle ne bloque jamais une vente. Elle vit
// 24 h au plus, pour qu'une facture oubliée ou un appareil resté hors
// connexion ne laisse pas de stock fantôme. Écritures par le serveur
// uniquement (/api/stock/reservations) ; le navigateur lit seulement.

import { withTimeout } from '@/lib/utils/with-timeout'

export const HELD_CART_SOURCE = 'held_cart'
export const RESERVATION_TTL_MS = 24 * 60 * 60 * 1000
export const RESERVATION_MAX_LINES = 500

type Db = { from: (table: string) => any }

export interface ReservationRow {
  product_id: string
  quantity: number
  source_ref: string
}

/** Facture en attente, telle que la caisse la garde sur l'appareil */
export interface HeldDraftLike {
  id: string
  shopId: string
  createdAt: string
  label?: string
  cart: { product: { id: string }; quantity: number }[]
}

// ── Règles pures ───────────────────────────────────────────────────────────

/**
 * Lignes à réserver : une par produit (doublons additionnés), quantités
 * entières, plafonnées au stock physique — on ne réserve jamais plus que ce
 * qui est en rayon. Un produit inconnu de la boutique ou épuisé est ignoré.
 */
export function normalizeReservationItems(
  items: unknown,
  physicalById: Record<string, number>,
): { product_id: string; quantity: number }[] {
  if (!Array.isArray(items)) return []
  const wanted: Record<string, number> = {}
  for (const it of items) {
    const id = typeof it?.product_id === 'string' ? it.product_id : ''
    const qty = Math.floor(Number(it?.quantity))
    if (!id || !(qty > 0) || !(id in physicalById)) continue
    wanted[id] = (wanted[id] || 0) + qty
  }
  const lines: { product_id: string; quantity: number }[] = []
  for (const [product_id, qty] of Object.entries(wanted)) {
    const quantity = Math.min(qty, Math.floor(Number(physicalById[product_id]) || 0))
    if (quantity > 0) lines.push({ product_id, quantity })
  }
  return lines
}

/**
 * Fin de la réservation : 24 h après la mise en attente. L'appareil envoie
 * l'ÂGE de la facture (une durée, insensible à une horloge mal réglée), pas
 * une date. null : la facture a déjà plus de 24 h, rien à réserver.
 */
export function reservationExpiry(nowMs: number, ageMs: unknown): Date | null {
  const age = Math.max(0, Number(ageMs) || 0)
  if (age >= RESERVATION_TTL_MS) return null
  return new Date(nowMs + RESERVATION_TTL_MS - age)
}

/**
 * Quantité réservée par produit.
 * - `rows` : réservations vivantes lues sur le serveur ;
 * - `localDrafts` (caisse) : factures en attente de CET appareil — elles
 *   priment sur leur copie serveur (connues même hors connexion) et suivent la
 *   même limite de 24 h ;
 * - `excludeRef` (caisse) : la facture reprise, en cours dans le panier — ses
 *   articles ne sont pas « pris par quelqu'un d'autre » ;
 * - `syncedAt` + `rowsLoadedAt` (caisse) : une facture de cet appareil dont la
 *   réservation a bien été envoyée, puis relue sur le serveur APRÈS cet envoi,
 *   suit le serveur — si un responsable l'a libérée depuis la fiche produit,
 *   elle ne compte plus ici non plus.
 */
export function reservedByProduct(
  rows: ReservationRow[],
  opts: ReservedOptions = {},
): Record<string, number> {
  const local = opts.localDrafts || []
  const localRefs = new Set(local.map(d => d.id))
  const now = opts.now ?? Date.now()
  const trustServer = serverTruth(opts)
  const map: Record<string, number> = {}
  const add = (id: string, qty: number) => { if (id && qty > 0) map[id] = (map[id] || 0) + qty }
  for (const r of rows) {
    if (r.source_ref === opts.excludeRef) continue
    if (localRefs.has(r.source_ref) && !trustServer(r.source_ref)) continue
    add(r.product_id, Number(r.quantity) || 0)
  }
  for (const d of local) {
    if (d.id === opts.excludeRef || trustServer(d.id)) continue
    if (now - new Date(d.createdAt).getTime() >= RESERVATION_TTL_MS) continue
    for (const i of d.cart || []) add(i.product?.id, Math.floor(Number(i.quantity) || 0))
  }
  return map
}

export interface ReservedOptions {
  localDrafts?: HeldDraftLike[]
  excludeRef?: string | null
  now?: number
  /** Factures de cet appareil dont la réservation a été envoyée : identifiant → heure de l'envoi */
  syncedAt?: Record<string, number>
  /** Heure de DÉPART de la dernière lecture réussie des réservations (absente = jamais lue) */
  rowsLoadedAt?: number | null
}

/** Le serveur fait foi pour une facture locale quand il a été relu après l'envoi de sa réservation. */
function serverTruth(opts: ReservedOptions): (ref: string) => boolean {
  const { syncedAt, rowsLoadedAt } = opts
  return ref => rowsLoadedAt != null && syncedAt?.[ref] != null && rowsLoadedAt >= syncedAt[ref]
}

/**
 * Factures en attente de cet appareil dont la réservation n'existe plus sur
 * le serveur alors qu'elle y avait été envoyée et qu'elle a moins de 24 h :
 * un responsable l'a libérée. La caisse le signale sur la facture.
 */
export function releasedHeldRefs(rows: ReservationRow[], opts: ReservedOptions = {}): Set<string> {
  const trustServer = serverTruth(opts)
  const now = opts.now ?? Date.now()
  const live = new Set(rows.map(r => r.source_ref))
  const out = new Set<string>()
  for (const d of opts.localDrafts || []) {
    if (!trustServer(d.id) || live.has(d.id)) continue
    if (now - new Date(d.createdAt).getTime() >= RESERVATION_TTL_MS) continue
    if ((d.cart || []).length) out.add(d.id)
  }
  return out
}

// ── Lecture (navigateur, membres de la boutique) ───────────────────────────

/** Réservations vivantes des boutiques demandées. */
export async function fetchReservationRows(supabase: Db, shopIds: string[], nowIso: string = new Date().toISOString()): Promise<ReservationRow[]> {
  if (!shopIds.length) return []
  const PAGE = 1000
  const rows: ReservationRow[] = []
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await withTimeout<any>(supabase
      .from('stock_reservations')
      .select('id, product_id, quantity, source_ref')
      .in('shop_id', shopIds)
      .gt('expires_at', nowIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1), 20_000)
    if (error) throw error
    rows.push(...((data || []) as ReservationRow[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

/** Quantité réservée par produit (module Stock). */
export async function fetchReservedQtyByProduct(supabase: Db, shopIds: string[]): Promise<Record<string, number>> {
  return reservedByProduct(await fetchReservationRows(supabase, shopIds))
}

// ── Envoi depuis la caisse ─────────────────────────────────────────────────
// La mise en attente ne doit jamais attendre le réseau : la facture est
// enregistrée sur l'appareil, puis sa réservation part en arrière-plan. Ce
// qui n'a pas pu partir (hors connexion) reste noté ici et repart au retour
// du réseau. Une seule note par facture : « à mettre au même état que
// l'appareil » — facture encore là → réserver ; facture disparue → libérer.

const PENDING_KEY = 'nc_reservation_sync'
const SYNCED_KEY = 'nc_reservation_synced'

/** Factures de cet appareil dont la réservation est partie : identifiant → heure de l'envoi. */
export function readSyncedAt(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SYNCED_KEY) || '{}') || {} } catch { return {} }
}
function setSynced(ref: string, at: number | null): void {
  try {
    const map = readSyncedAt()
    if (at === null) delete map[ref]; else map[ref] = at
    localStorage.setItem(SYNCED_KEY, JSON.stringify(map))
  } catch { /* stockage refusé : la facture reste comptée d'après l'appareil */ }
}
type PendingMap = Record<string, { shopId: string; n: number }>

function readPending(): PendingMap | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writePending(map: PendingMap): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)) } catch { /* stockage plein ou refusé : la réservation expirera seule */ }
}

let counter = 0

/** Note qu'une facture en attente a changé (créée, modifiée ou supprimée). */
export function markReservationPending(sourceRef: string, shopId: string): void {
  if (!sourceRef || !shopId) return
  const map = readPending() || {}
  map[sourceRef] = { shopId, n: Date.now() * 100 + (counter++ % 100) }
  writePending(map)
  // Tant que le nouvel état n'est pas parti, l'appareil fait foi pour cette facture
  setSynced(sourceRef, null)
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * Envoie tout ce qui est noté. Appels en file : jamais deux envois en même
 * temps. `readDrafts` relit les factures sur l'appareil au moment de l'envoi.
 * Renvoie true si au moins une réservation a changé sur le serveur.
 */
export function flushReservations(readDrafts: () => HeldDraftLike[]): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    let pending = readPending()
    if (pending === null) {
      // Premier passage sur cet appareil : les factures déjà en attente
      // réservent elles aussi (celles de plus de 24 h sont ignorées par le serveur)
      pending = {}
      for (const d of readDrafts()) if (d.id && d.shopId) pending[d.id] = { shopId: d.shopId, n: 0 }
      writePending(pending)
    }
    let changed = false
    for (const [ref, mark] of Object.entries(pending)) {
      const draft = readDrafts().find(d => d.id === ref)
      let settled = false
      try {
        const res = draft
          ? await fetch('/api/stock/reservations', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                shop_id: draft.shopId,
                source_ref: ref,
                label: draft.label || null,
                age_ms: Math.max(0, Date.now() - new Date(draft.createdAt).getTime()),
                items: (draft.cart || []).map(i => ({ product_id: i.product?.id, quantity: i.quantity })),
              }),
            })
          : await fetch(`/api/stock/reservations?shop_id=${encodeURIComponent(mark.shopId)}&source_ref=${encodeURIComponent(ref)}`, { method: 'DELETE' })
        // Refus définitif (droit retiré, donnée invalide) : inutile de réessayer.
        // Erreur du serveur ou trop de demandes : on réessaiera.
        settled = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)
        if (res.ok) { changed = true; setSynced(ref, draft ? Date.now() : null) }
      } catch { /* hors connexion : reste noté */ }
      if (settled) {
        // La facture a pu rechanger pendant l'envoi : sa note est alors plus récente, on la garde
        const current = readPending() || {}
        if (current[ref]?.n === mark.n) { delete current[ref]; writePending(current) }
      }
    }
    return changed
  }
  const next = chain.then(run, run)
  chain = next.catch(() => false)
  return next
}
