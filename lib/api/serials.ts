// Numéros de série (étape 11 du Stock, migrations 197 et 198, 1er nov. 2026) : règles serveur communes.
// Registre réservé au serveur (product_serials) ; les fonctions SQL contrôlent et écrivent dans une transaction,
// ces aides ne font que nettoyer l'entrée et traduire les refus.

export const MAX_SERIALS_PER_CALL = 500

/** Liste de numéros propre : texte, espaces retirés, vides écartés ; null si la forme est invalide */
export function cleanSerials(input: unknown): string[] | null {
  if (input == null) return []
  const raw = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[\n\r,;]+/) : null
  if (!raw) return null
  const out = raw.map(x => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '')).filter(Boolean)
  if (out.length > MAX_SERIALS_PER_CALL || out.some(s => s.length > 64)) return null
  return out
}

/** Lignes de vente : seuls des numéros propres sont transmis à complete_sale */
export function withCleanSerials<T extends { serials?: unknown }>(items: T[]): T[] {
  return items.map(it => {
    const s = cleanSerials(it?.serials)
    const { serials: _drop, ...rest } = it as any
    return (s && s.length ? { ...rest, serials: s } : rest) as T
  })
}

/** Refus SQL des numéros (P0041 à P0047) → message traduit ; null si l'erreur n'en est pas un */
export function serialErrorResponse(error: any, t: (k: any, v?: any) => string): { status: number; body: Record<string, unknown> } | null {
  const code = String(error?.code || '')
  const detail = String(error?.details || error?.detail || '')
  const map: Record<string, string> = {
    P0041: 'serial_count_mismatch', P0042: 'serial_taken', P0043: 'serial_invalid', P0044: 'serial_duplicate_input',
    P0045: 'serial_exceeds_stock', P0046: 'serial_not_in_stock', P0047: 'serial_product_not_tracked',
  }
  const key = map[code]
  if (!key) return null
  return { status: code === 'P0042' ? 409 : 400, body: { error: t(key, { serial: detail, product: detail }), code: key, serial: detail || null } }
}

/** Numéros vendus par ligne de vente (pour le ticket, le détail et l'historique) */
export async function serialsBySaleItem(admin: any, saleItemIds: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {}
  if (!saleItemIds.length) return out
  for (let i = 0; i < saleItemIds.length; i += 200) {
    const { data } = await admin.from('product_serials').select('serial, sale_item_id').in('sale_item_id', saleItemIds.slice(i, i + 200)).order('serial')
    for (const r of data || []) (out[r.sale_item_id] ||= []).push(r.serial)
  }
  return out
}

/** Vente renvoyée à l'appareil : chaque ligne porte ses numéros (serials), s'il y en a */
export async function withSaleSerials(admin: any, sale: any): Promise<any> {
  const items = Array.isArray(sale?.sale_items) ? sale.sale_items : []
  if (!items.length) return sale
  const by = await serialsBySaleItem(admin, items.map((x: any) => x.id).filter(Boolean))
  if (!Object.keys(by).length) return sale
  return { ...sale, sale_items: items.map((x: any) => (by[x.id] ? { ...x, serials: by[x.id] } : x)) }
}

/** Produits suivis par numéro de série parmi ces produits (noms) : leurs transferts attendent le lot C (numéros en
 *  transit) ; d'ici là, un transfert qui en contient est refusé (jamais d'unités sans numéro dans la boutique d'arrivée) */
export async function trackedProductNames(admin: any, productIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = Array.from(new Set(productIds.filter(Boolean))) as string[]
  if (!ids.length) return []
  const { data } = await admin.from('products').select('name').in('id', ids).eq('track_serials', true)
  return (data || []).map((p: any) => p.name)
}
