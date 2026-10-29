// Motif d'un mouvement de stock, dans la langue de l'écran.
//
// La base écrit le motif en texte libre, dans la langue de la fonction qui l'a
// créé (« Sale BOU-0504 », « Annulation vente #BOU-0305 », « Restock from … »,
// « Transfert TR-2026-0002 vers … »). On ne réécrit pas l'historique : on
// reconnaît chaque forme à l'affichage. Un motif inconnu (saisi à la main,
// forme future) est rendu tel quel — jamais remplacé par un libellé deviné.

export type MovementReason =
  | { key: 'reason_sale' | 'reason_sale_cancelled' | 'reason_sale_edited' | 'reason_po_received'; params: { ref: string } }
  | { key: 'reason_initial' | 'reason_restock' | 'reason_inventory_correction' | 'reason_inventory_loss' | 'reason_inventory_damage' | 'reason_inventory_expiry' }
  | { key: 'reason_restock_from'; params: { name: string } }
  | { key: 'reason_transfer_out' | 'reason_transfer_in'; params: { ref: string; shop: string } }
  | { key: 'reason_inventory_other'; params: { detail: string } }
  | { key: 'reason_transfer_cancelled' | 'reason_transfer_missing'; params: { ref: string } }
  // Lot corrigé ou supprimé à la main (fiche produit) ; cause connue, ou null avec le texte enregistré
  | { key: 'reason_batch_corrected' | 'reason_batch_deleted'; params: { detail: string }; cause: 'correction' | 'loss' | 'damage' | 'expiry' | null }
  | { key: null; raw: string }

const BATCH_CAUSE: Record<string, 'correction' | 'loss' | 'damage' | 'expiry'> = {
  'correction de stock': 'correction',
  'perte': 'loss',
  'dommage': 'damage',
  'expiration': 'expiry',
}

const INVENTORY: Record<string, 'reason_inventory_correction' | 'reason_inventory_loss' | 'reason_inventory_damage' | 'reason_inventory_expiry'> = {
  'correction de stock': 'reason_inventory_correction',
  'perte': 'reason_inventory_loss',
  'dommage': 'reason_inventory_damage',
  'expiration': 'reason_inventory_expiry',
}

export function describeMovementReason(reason: string | null | undefined): MovementReason | null {
  const raw = (reason || '').trim()
  if (!raw) return null
  let m: RegExpMatchArray | null
  if ((m = raw.match(/^Sale\s+(\S.*)$/))) return { key: 'reason_sale', params: { ref: m[1] } }
  if ((m = raw.match(/^Annulation vente\s+#?(\S.*)$/))) return { key: 'reason_sale_cancelled', params: { ref: m[1] } }
  if ((m = raw.match(/^Modification vente\s+#?(\S.*)$/))) return { key: 'reason_sale_edited', params: { ref: m[1] } }
  if (raw === 'Stock initial') return { key: 'reason_initial' }
  if (raw === 'Restock' || raw === 'Restock from supplier') return { key: 'reason_restock' }
  if ((m = raw.match(/^Restock from\s+(\S.*)$/))) return { key: 'reason_restock_from', params: { name: m[1] } }
  if ((m = raw.match(/^Réception\s+(\S+)$/))) return { key: 'reason_po_received', params: { ref: m[1] } }
  // Migration 188 : unités manquantes à la réception, écart enregistré à la source (aucun stock ne bouge)
  if ((m = raw.match(/^Transfert\s+(\S+)\s+:\s+manquant à la réception$/))) return { key: 'reason_transfer_missing', params: { ref: m[1] } }
  if ((m = raw.match(/^Transfert\s+(\S+)\s+vers\s+(\S.*)$/))) return { key: 'reason_transfer_out', params: { ref: m[1], shop: m[2] } }
  if ((m = raw.match(/^Transfert\s+(\S+)\s+depuis\s+(\S.*)$/))) return { key: 'reason_transfer_in', params: { ref: m[1], shop: m[2] } }
  if ((m = raw.match(/^Annulation transfert\s+(\S+)$/))) return { key: 'reason_transfer_cancelled', params: { ref: m[1] } }
  if ((m = raw.match(/^(Correction|Suppression) de lot\s+[—–-]\s+(\S.*)$/))) {
    const detail = m[2].trim()
    return { key: m[1] === 'Correction' ? 'reason_batch_corrected' : 'reason_batch_deleted', params: { detail }, cause: BATCH_CAUSE[detail.toLowerCase()] ?? null }
  }
  if ((m = raw.match(/^Inventaire physique\s+[—–-]\s+(\S.*)$/))) {
    const known = INVENTORY[m[1].trim().toLowerCase()]
    return known ? { key: known } : { key: 'reason_inventory_other', params: { detail: m[1].trim() } }
  }
  return { key: null, raw }
}

/**
 * Débuts de motif suivis d'une référence ou d'un nom (numéro de vente, bon de
 * commande, transfert et boutique, fournisseur). La recherche de l'onglet
 * Mouvements cherche APRÈS ce début : taper « sal » ne ramène pas toutes les
 * ventes parce que leur motif commence par « Sale ».
 */
export const REASON_REFERENCE_PREFIXES = ['Sale ', 'Annulation vente ', 'Modification vente ', 'Réception ', 'Transfert ', 'Annulation transfert ', 'Restock from ']

/**
 * Débuts de motif des mouvements de TRANSFERT (envoyé, reçu, annulé) : c'est
 * ce qui range un mouvement dans la catégorie « Transferts » de l'onglet
 * Mouvements, quel que soit son type (entrée ou sortie).
 */
export const TRANSFER_REASON_PREFIXES = ['Transfert ', 'Annulation transfert ']

/** Texte à afficher ; `t` = traducteur du bloc « movements ». */
export function movementReasonText(reason: string | null | undefined, t: (key: string, params?: Record<string, string>) => string): string | null {
  const d = describeMovementReason(reason)
  if (!d) return null
  if (d.key === null) return d.raw
  return 'params' in d ? t(d.key, d.params) : t(d.key)
}
