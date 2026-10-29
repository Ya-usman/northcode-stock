// Stock › Transferts V1 — règles PURES de la liste (testées : tests/e2e/transfers-v1-pure.mjs).
// Compteurs (Tous / En transit / Reçus), recherche (référence, boutiques, produits), filtres : OU à l'intérieur d'une
// dimension, ET entre les dimensions ; période ; jours en transit (« En transit depuis 2 jours » à partir de 2 jours).
import { foldText, matchesAny } from '@/lib/filters/multi-select'

export type TransferStatus = 'draft' | 'sent' | 'received' | 'cancelled'
export type TransferPeriod = 'all' | 'today' | '7d' | '30d' | 'month'

export interface TransferRow {
  id: string
  reference: string
  status: TransferStatus
  source_shop_id: string
  destination_shop_id: string
  source_shop_name: string | null
  destination_shop_name: string | null
  created_at: string
  sent_at?: string | null
  received_at?: string | null
  created_by?: string | null
  created_by_name?: string | null
  stock_transfer_items?: { source_product_id?: string | null; product_name: string; quantity_sent: number }[]
}

export interface TransferFilters {
  statuses: string[]
  sources: string[]
  destinations: string[]
  products: string[]
  creators: string[]
  period: TransferPeriod
}

export const EMPTY_TRANSFER_FILTERS: TransferFilters = { statuses: [], sources: [], destinations: [], products: [], creators: [], period: 'all' }

/** Nombre de filtres actifs (pastille du bouton « Filtrer ») : une dimension = 1, quel que soit le nombre de valeurs */
export function activeFilterCount(f: TransferFilters): number {
  return [f.statuses, f.sources, f.destinations, f.products, f.creators].filter(v => v.length > 0).length + (f.period !== 'all' ? 1 : 0)
}

/** Compteurs du haut : Tous (hors annulés et brouillons compris), En transit, Reçus — sur la liste déjà cherchée */
export function transferKpis(rows: TransferRow[]): { all: number; in_transit: number; received: number } {
  return {
    all: rows.length,
    in_transit: rows.filter(r => r.status === 'sent').length,
    received: rows.filter(r => r.status === 'received').length,
  }
}

/** Début de la période (heure de l'appareil, affichage seulement) ; null = toutes les dates */
export function periodStart(period: TransferPeriod, now: Date = new Date()): Date | null {
  const d = new Date(now)
  switch (period) {
    case 'today': d.setHours(0, 0, 0, 0); return d
    case '7d': d.setDate(d.getDate() - 7); return d
    case '30d': d.setDate(d.getDate() - 30); return d
    case 'month': return new Date(now.getFullYear(), now.getMonth(), 1)
    default: return null
  }
}

/** Date utile d'un transfert pour la période : envoi (ou création pour un brouillon) */
export const transferDate = (r: TransferRow): string => r.sent_at || r.created_at

export function searchTransfers(rows: TransferRow[], query: string): TransferRow[] {
  const q = foldText(query || '').trim()
  if (!q) return rows
  return rows.filter(r =>
    foldText(r.reference || '').includes(q)
    || foldText(r.source_shop_name || '').includes(q)
    || foldText(r.destination_shop_name || '').includes(q)
    || (r.stock_transfer_items || []).some(it => foldText(it.product_name || '').includes(q)))
}

export function filterTransfers(rows: TransferRow[], f: TransferFilters, now: Date = new Date()): TransferRow[] {
  const start = periodStart(f.period, now)
  return rows.filter(r =>
    matchesAny(f.statuses, v => r.status === v)
    && matchesAny(f.sources, v => r.source_shop_id === v)
    && matchesAny(f.destinations, v => r.destination_shop_id === v)
    && matchesAny(f.products, v => (r.stock_transfer_items || []).some(it => it.source_product_id === v))
    && matchesAny(f.creators, v => r.created_by === v)
    && (!start || new Date(transferDate(r)).getTime() >= start.getTime()))
}

/** Jours entiers écoulés depuis l'envoi d'un transfert en transit ; null s'il n'est pas en transit */
export function transitDays(r: Pick<TransferRow, 'status' | 'sent_at' | 'created_at'>, now: Date = new Date()): number | null {
  if (r.status !== 'sent') return null
  const sent = new Date(r.sent_at || r.created_at).getTime()
  if (!Number.isFinite(sent)) return null
  return Math.max(0, Math.floor((now.getTime() - sent) / 86_400_000))
}

/** En transit depuis assez longtemps pour le signaler (orange léger) */
export const LATE_TRANSIT_DAYS = 2
export const isLateTransit = (days: number | null): boolean => days != null && days >= LATE_TRANSIT_DAYS

/** Totaux d'une carte : « 2 produits · 18 unités » */
export function transferTotals(r: Pick<TransferRow, 'stock_transfer_items'>): { products: number; units: number } {
  const items = r.stock_transfer_items || []
  return { products: items.length, units: items.reduce((n, it) => n + (Number(it.quantity_sent) || 0), 0) }
}

// ── Réception ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ReceiveLine { item_id: string; sent: number; received: number }

/** Résumé de la réception : articles vérifiés, envoyé, reçu, écart (jamais négatif : reçu ≤ envoyé en V1) */
export function receiveSummary(lines: ReceiveLine[]): { articles: number; sent: number; received: number; missing: number } {
  const sent = lines.reduce((n, l) => n + l.sent, 0)
  const received = lines.reduce((n, l) => n + Math.min(Math.max(0, l.received), l.sent), 0)
  return { articles: lines.length, sent, received, missing: sent - received }
}

/** Quantité reçue bornée entre 0 et l'envoyé (V1 : jamais plus que l'envoyé) */
export const clampReceived = (value: number, sent: number): number => Math.min(Math.max(0, Math.floor(Number(value) || 0)), sent)

/**
 * Scan d'un article à la réception (mode « Scanner les articles ») : ligne dont le code-barres correspond.
 * 'added' : +1 ; 'full' : quantité envoyée déjà atteinte ; 'unknown' : produit hors transfert.
 */
export function scanArticle(
  lines: { item_id: string; sku: string | null; sent: number; received: number }[],
  code: string,
): { result: 'added' | 'full' | 'unknown'; item_id?: string } {
  const c = String(code || '').trim()
  if (!c) return { result: 'unknown' }
  const matches = lines.filter(l => (l.sku || '').trim() === c)
  if (!matches.length) return { result: 'unknown' }
  const open = matches.find(l => l.received < l.sent)
  if (!open) return { result: 'full', item_id: matches[0].item_id }
  return { result: 'added', item_id: open.item_id }
}
