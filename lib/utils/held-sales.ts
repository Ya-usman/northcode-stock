// Ventes mises en attente ("tickets ouverts") — logique pure, testable.
//
// À la reprise d'une vente en attente, le panier enregistré peut être
// périmé : prix changé (promo terminée, nouveau tarif), stock baissé,
// produit épuisé ou archivé. On le revérifie contre la liste produits
// actuelle, et on SIGNALE chaque changement au caissier — jamais de
// correction silencieuse.

import type { CartItem, Product } from '@/lib/types/database'

export type HeldCartChange =
  | { kind: 'removed'; name: string }
  | { kind: 'capped'; name: string; from: number; to: number }
  | { kind: 'price'; name: string; from: number; to: number }

/**
 * @param cart        panier tel qu'enregistré à la mise en attente
 * @param products    produits actuellement vendables (actifs, stock > 0)
 * @param priceOf     prix automatique actuel d'un produit (promos comprises)
 * @param manualIds   produits dont le prix avait été modifié À LA MAIN au
 *                    moment de la mise en attente (prix conservé). `null`
 *                    pour une vente en attente plus ancienne que ce suivi :
 *                    on considère alors "manuel" un prix différent du prix
 *                    catalogue enregistré.
 */
export function revalidateHeldCart(
  cart: CartItem[],
  products: Product[],
  priceOf: (p: Product) => number,
  manualIds: string[] | null,
): { cart: CartItem[]; changes: HeldCartChange[] } {
  const byId = new Map(products.map(p => [p.id, p]))
  const manual = manualIds ? new Set(manualIds) : null
  const changes: HeldCartChange[] = []
  const out: CartItem[] = []

  for (const item of cart) {
    const current = byId.get(item.product.id)
    if (!current || Number(current.quantity) <= 0) {
      changes.push({ kind: 'removed', name: item.product.name })
      continue
    }
    let quantity = item.quantity
    if (quantity > Number(current.quantity)) {
      changes.push({ kind: 'capped', name: current.name, from: quantity, to: Number(current.quantity) })
      quantity = Number(current.quantity)
    }
    const wasManual = manual
      ? manual.has(item.product.id)
      : item.unit_price !== Number(item.product.selling_price)
    let unitPrice = item.unit_price
    if (!wasManual) {
      const now = priceOf(current)
      if (now !== item.unit_price) {
        changes.push({ kind: 'price', name: current.name, from: item.unit_price, to: now })
        unitPrice = now
      }
    }
    out.push({ product: current, quantity, unit_price: unitPrice, subtotal: quantity * unitPrice })
  }
  return { cart: out, changes }
}

export const HELD_STALE_DAYS = 7

export function heldAgeDays(createdAt: string, now = Date.now()): number {
  return Math.floor((now - new Date(createdAt).getTime()) / 86_400_000)
}
