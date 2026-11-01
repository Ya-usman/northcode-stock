// Lignes de bon de commande saisies en colis (étape 9, migration 195) : le SERVEUR retrouve le conditionnement en base
// (jamais le nombre d'unités envoyé par l'appareil), le fige sur la ligne (pack_unit, units_per_pack, pack_qty) et en
// déduit quantity_ordered en unité de base. Sans conditionnement : ligne inchangée (colonnes de colis vides).
export interface PackFields { pack_unit: string | null; units_per_pack: number | null; pack_qty: number | null; quantity_ordered: number }

export async function resolvePackLines(
  admin: any, shopId: string, items: { product_id?: string | null; packaging_id?: string | null; pack_qty?: unknown; quantity_ordered?: unknown }[],
): Promise<{ ok: true; lines: PackFields[] } | { ok: false; error: 'packaging_not_found' | 'packaging_invalid_qty' }> {
  const ids = Array.from(new Set(items.map(it => it.packaging_id).filter((x): x is string => typeof x === 'string' && !!x)))
  const byId: Record<string, { product_id: string; unit: string; units_per_pack: number }> = {}
  if (ids.length) {
    const { data } = await admin.from('product_packagings').select('id, product_id, unit, units_per_pack').eq('shop_id', shopId).in('id', ids)
    for (const p of data || []) byId[p.id] = p
  }
  const lines: PackFields[] = []
  for (const it of items) {
    if (!it.packaging_id) { lines.push({ pack_unit: null, units_per_pack: null, pack_qty: null, quantity_ordered: Number(it.quantity_ordered) }); continue }
    const pk = byId[it.packaging_id]
    if (!pk || pk.product_id !== it.product_id) return { ok: false, error: 'packaging_not_found' }
    const packs = Number(it.pack_qty)
    if (!Number.isInteger(packs) || packs < 1 || packs > 100000) return { ok: false, error: 'packaging_invalid_qty' }
    lines.push({ pack_unit: pk.unit, units_per_pack: pk.units_per_pack, pack_qty: packs, quantity_ordered: packs * pk.units_per_pack })
  }
  return { ok: true, lines }
}

/** Colonnes à écrire : celles de colis seulement pour une ligne en colis (une ligne à l'unité s'écrit comme avant la 195) */
export function packRow(l: PackFields): Partial<PackFields> & { quantity_ordered: number } {
  return l.pack_qty != null ? l : { quantity_ordered: l.quantity_ordered }
}
