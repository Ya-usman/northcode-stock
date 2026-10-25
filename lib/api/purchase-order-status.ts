// Changements de statut d'un bon de commande par la route générale (PATCH /api/purchase-orders).
// Matrice FERMÉE : seuls brouillon → envoyé, brouillon → annulé et envoyé → annulé passent. « Reçu » et « partiel »
// ne s'obtiennent QUE par la réception (apply_purchase_order_receipt, /api/purchase-orders/receive) : elle seule
// écrit le stock, les lots, le prix d'achat moyen et la dette fournisseur. Un bon reçu (même en partie) ne peut
// plus être annulé ni revenir en arrière ici : stock, lots et dette resteraient en place (ou seraient comptés deux
// fois à une nouvelle réception). Cas historique : BC-2026-0001 (Boutique Alpha, 14 juil. 2026) passé en « reçu »
// par un simple changement de statut, sans mouvement ni lot — conservé tel quel.
//
// Module sans dépendance (testé par tests/e2e/po-status-transitions-pure.mjs).

export const PO_STATUSES = ['draft', 'sent', 'partial', 'received', 'cancelled'] as const
export type PoStatus = (typeof PO_STATUSES)[number]

const ALLOWED: Record<string, readonly string[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['cancelled'],
}

export const PO_TRANSITION_NOT_ALLOWED = 'purchase_order_status_transition_not_allowed'
export const PO_STATUS_CHANGED = 'purchase_order_status_changed'

export type PoTransitionCheck =
  | { kind: 'allowed' }
  | { kind: 'noop' }
  | { kind: 'unknown_status' }
  | { kind: 'not_allowed'; reason: 'already_received' | 'receipt_only' | 'not_allowed' }

export function checkPoStatusTransition(from: string, to: string): PoTransitionCheck {
  if (!(PO_STATUSES as readonly string[]).includes(to)) return { kind: 'unknown_status' }
  if (from === to) return { kind: 'noop' }
  if (ALLOWED[from]?.includes(to)) return { kind: 'allowed' }
  if (from === 'received' || from === 'partial') return { kind: 'not_allowed', reason: 'already_received' }
  if (from === 'cancelled') return { kind: 'not_allowed', reason: 'not_allowed' } // annulé = définitif (la réception le refuse aussi)
  if (to === 'received' || to === 'partial') return { kind: 'not_allowed', reason: 'receipt_only' }
  return { kind: 'not_allowed', reason: 'not_allowed' }
}

/** Clé du message (namespace api_errors) d'un refus de transition */
export function poTransitionErrorKey(reason: 'already_received' | 'receipt_only' | 'not_allowed'): string {
  if (reason === 'already_received') return 'po_already_received'
  if (reason === 'receipt_only') return 'po_status_receipt_only'
  return 'po_status_transition_not_allowed'
}

/**
 * Changement de statut ATOMIQUE : une seule instruction
 *   UPDATE purchase_orders SET … WHERE id = … AND shop_id = … AND status = <statut lu> RETURNING …
 * Si une réception (ou une autre modification) a changé le statut entre la lecture et l'écriture, aucune ligne
 * n'est modifiée : conflict = true, rien n'est écrit. La réception verrouille la ligne (FOR UPDATE) : l'UPDATE
 * attend sa fin puis réévalue la condition sur la ligne validée (READ COMMITTED) → 0 ligne.
 */
export async function updatePoStatusAtomically(
  admin: any,
  args: { id: string; shopId: string; from: string; updates: Record<string, unknown> }
): Promise<{ data: any; error: { message: string; code?: string } | null; conflict: boolean }> {
  const { data, error } = await admin
    .from('purchase_orders')
    .update(args.updates)
    .eq('id', args.id)
    .eq('shop_id', args.shopId)
    .eq('status', args.from)
    .select('id, shop_id, status, reference, updated_at') // jamais les montants (droit « voir les coûts » non vérifié ici)
    .maybeSingle()
  if (error) return { data: null, error, conflict: false }
  if (!data) return { data: null, error: null, conflict: true }
  return { data, error: null, conflict: false }
}
