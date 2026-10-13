import { describeMovementReason } from './movement-reason'

// Libellé MÉTIER d'un mouvement de stock : ce que le commerçant lit dans la
// liste et dans le détail (« Retour en stock », « Réception fournisseur »,
// « Produit endommagé »…), distinct des quatre catégories qui servent à
// filtrer (Entrées, Ventes, Ajustements, Transferts — /api/stock/movements).
// Règle pure : type + motif enregistrés → libellé, ligne de référence,
// origine. Un motif inconnu garde le libellé de son type et reste affiché tel
// qu'il a été saisi ; rien n'est deviné.

export type MovementOrigin =
  | { kind: 'sale'; ref: string; cancelled: boolean; edited: boolean }
  | { kind: 'purchase_order'; ref: string }
  | { kind: 'transfer'; ref: string; direction: 'out' | 'in'; otherShop: string; cancelled?: boolean }
  | { kind: 'batch'; action: 'corrected' | 'deleted' }
  | { kind: 'supplier'; name: string }
  | { kind: 'inventory' }
  | null

/** Texte : une clé du bloc « movements » avec ses paramètres, ou un texte libre enregistré tel quel. */
export type MovementText = { key: string; params?: Record<string, string> } | { raw: string }

export interface MovementView {
  /** Libellé métier (clé « movements.label_… ») */
  labelKey: string
  /** Seconde ligne de la liste : référence ou origine ; null quand le libellé dit déjà tout */
  detail: MovementText | null
  origin: MovementOrigin
  /** Motif saisi librement (aucune forme reconnue) : affiché tel quel dans le détail */
  freeReason: string | null
}

export interface MovementInput {
  type: string
  reason?: string | null
  /** Le mouvement vient d'un inventaire physique (séance de comptage), pas d'une correction isolée */
  inventory_count?: boolean | null
}

const TYPE_LABEL: Record<string, string> = { in: 'label_entry', sale: 'label_sale', out: 'label_exit', adjustment: 'label_adjustment' }
const INVENTORY_LABEL: Record<string, string> = {
  reason_inventory_loss: 'label_loss',
  reason_inventory_damage: 'label_damage',
  reason_inventory_expiry: 'label_expiry',
}

export function describeMovement(m: MovementInput): MovementView {
  const d = describeMovementReason(m.reason)
  const byType = TYPE_LABEL[m.type] || 'label_other'
  const view = (labelKey: string, detail: MovementText | null = null, origin: MovementOrigin = null): MovementView => ({ labelKey, detail, origin, freeReason: null })
  if (!d) return view(byType)
  if (d.key === null) return { labelKey: byType, detail: { raw: d.raw }, origin: null, freeReason: d.raw }
  // Écart constaté pendant un inventaire physique : la ligne le dit ; une correction isolée (un lot corrigé
  // depuis la fiche produit) porte le même motif en base, sans séance de comptage
  const counted = !!m.inventory_count
  const inventory: [MovementText | null, MovementOrigin] = counted ? [{ key: 'ref_inventory' }, { kind: 'inventory' }] : [null, null]
  switch (d.key) {
    case 'reason_sale':
      return view('label_sale', { raw: d.params.ref }, { kind: 'sale', ref: d.params.ref, cancelled: false, edited: false })
    case 'reason_sale_cancelled':
      return view('label_return', { key: 'reason_sale_cancelled', params: d.params }, { kind: 'sale', ref: d.params.ref, cancelled: true, edited: false })
    case 'reason_sale_edited':
      // Une vente modifiée rend du stock (entrée) ou en reprend (sortie de vente)
      return view(m.type === 'in' ? 'label_return' : 'label_sale', { key: 'reason_sale_edited', params: d.params }, { kind: 'sale', ref: d.params.ref, cancelled: false, edited: true })
    case 'reason_initial':
      return view('label_initial')
    case 'reason_restock':
      return view('label_restock')
    case 'reason_restock_from':
      return view('label_restock', { raw: d.params.name }, { kind: 'supplier', name: d.params.name })
    case 'reason_po_received':
      return view('label_supplier_receipt', { key: 'ref_purchase_order', params: d.params }, { kind: 'purchase_order', ref: d.params.ref })
    case 'reason_transfer_out':
      return view('label_transfer_sent', { key: 'ref_transfer_to', params: d.params }, { kind: 'transfer', ref: d.params.ref, direction: 'out', otherShop: d.params.shop })
    case 'reason_transfer_in':
      return view('label_transfer_received', { key: 'ref_transfer_from', params: d.params }, { kind: 'transfer', ref: d.params.ref, direction: 'in', otherShop: d.params.shop })
    case 'reason_transfer_cancelled':
      // Le stock revient dans la boutique qui avait envoyé le transfert
      return view('label_transfer_cancelled', { raw: d.params.ref }, { kind: 'transfer', ref: d.params.ref, direction: 'out', otherShop: '', cancelled: true })
    case 'reason_batch_corrected':
    case 'reason_batch_deleted': {
      const action = d.key === 'reason_batch_deleted' ? 'deleted' : 'corrected'
      const labels = { correction: 'label_stock_correction', loss: 'label_loss', damage: 'label_damage', expiry: 'label_expiry' } as const
      const origin: MovementOrigin = { kind: 'batch', action }
      if (d.cause) return view(labels[d.cause], { key: action === 'deleted' ? 'ref_batch_deleted' : 'ref_batch_corrected' }, origin)
      return { labelKey: 'label_stock_correction', detail: { raw: d.params.detail }, origin, freeReason: d.params.detail }
    }
    case 'reason_inventory_correction':
      return view(counted ? 'label_inventory_adjustment' : 'label_stock_correction', inventory[0], inventory[1])
    case 'reason_inventory_loss':
    case 'reason_inventory_damage':
    case 'reason_inventory_expiry':
      return view(INVENTORY_LABEL[d.key], inventory[0], inventory[1])
    case 'reason_inventory_other':
      return { labelKey: counted ? 'label_inventory_adjustment' : 'label_stock_correction', detail: { raw: d.params.detail }, origin: inventory[1], freeReason: d.params.detail }
  }
}

/** Rend un `MovementText` dans la langue de l'écran ; `t` = traducteur du bloc « movements ». */
export function movementText(text: MovementText | null, t: (key: string, params?: Record<string, string>) => string): string | null {
  if (!text) return null
  if ('raw' in text) return text.raw
  return text.params ? t(text.key, text.params) : t(text.key)
}

/**
 * Variation réelle du stock : après − avant quand la base a noté les deux,
 * sinon le sens du type (entrée +, vente et sortie −). null : inconnue (un
 * ajustement sans avant / après) — rien n'est alors affiché.
 */
export function movementDelta(m: { type: string; quantity: number; previous_qty?: number | null; new_qty?: number | null }): number | null {
  if (m.previous_qty != null && m.new_qty != null) return Number(m.new_qty) - Number(m.previous_qty)
  const sign = m.type === 'in' ? 1 : m.type === 'sale' || m.type === 'out' ? -1 : 0
  return sign === 0 ? null : sign * Math.abs(Number(m.quantity) || 0)
}

/** Texte de recherche envoyé au serveur : sans les caractères qui ont un sens dans un filtre de la base. */
export function sanitizeMovementSearch(q: string | null | undefined): string {
  return String(q || '').replace(/[%_,()*\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/** Longueur à partir de laquelle la recherche est envoyée au serveur */
export const MOVEMENT_SEARCH_MIN = 2
