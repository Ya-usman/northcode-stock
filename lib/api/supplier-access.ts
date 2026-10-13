import { canViewCost, canViewFeature } from '@/lib/api/role-permissions'

// Fournisseurs : deux notions à ne pas confondre.
//
//  - Le PRIX D'ACHAT d'un produit — prix unitaire d'une ligne de bon de
//    commande, comparateur de prix entre fournisseurs, coût, marge : règle
//    unique `canViewCost` (lib/permissions).
//  - La DETTE envers un fournisseur — montant dû, payé, solde, statut,
//    paiements : droit « Crédits ». Il suffit pour consulter une dette et
//    enregistrer un paiement ; il ne donne pas les prix d'achat.
//
// Conséquence : dans Crédits, une dette est montrée bon par bon (référence,
// date, total, payé, solde) ; les lignes détaillées du bon (produit ×
// quantité × prix unitaire) ne sont envoyées qu'avec `canViewCost`. Dans
// Fournisseurs, sans `canViewCost`, un bon garde ses lignes (ce qui est
// commandé et reçu) mais ni prix unitaires ni montants.

/** Lignes détaillées d'un bon : elles portent le prix d'achat unitaire */
export const PO_LINES = 'purchase_order_items(product_name, quantity_ordered, quantity_received, unit_price)'

/**
 * Parmi `shopIds`, les boutiques où la personne voit les dettes fournisseurs
 * (membre active + droit Crédits) et, parmi elles, celles où elle voit aussi
 * les lignes détaillées (canViewCost).
 */
export async function supplierDebtShops(supabase: any, userId: string, shopIds: string[]): Promise<{ debts: string[]; lines: string[] }> {
  const { data: members } = await supabase
    .from('shop_members').select('shop_id, role')
    .in('shop_id', shopIds).eq('user_id', userId).eq('is_active', true)
  const debts: string[] = [], lines: string[] = []
  for (const m of members || []) {
    if (!(await canViewFeature(supabase, m.role, m.shop_id, 'payments'))) continue
    debts.push(m.shop_id)
    if (await canViewCost(supabase, m.role, m.shop_id)) lines.push(m.shop_id)
  }
  return { debts, lines }
}

/** Dette : le bon tel quel avec le droit de voir les coûts, sinon sans ses lignes détaillées. */
export function debtOrder<T extends Record<string, any>>(po: T, showLines: boolean): T {
  if (showLines) return po
  const { purchase_order_items: _lines, ...rest } = po
  return rest as T
}

/** Écran Fournisseurs sans le droit de voir les coûts : lignes sans prix unitaire, bon sans montants. */
export function orderWithoutCost<T extends Record<string, any>>(po: T): T {
  const { total_amount: _total, amount_paid: _paid, balance: _balance, ...rest } = po
  return {
    ...rest,
    purchase_order_items: (po.purchase_order_items || []).map(({ unit_price: _price, ...item }: any) => item),
  } as unknown as T
}
