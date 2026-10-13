import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { REASON_REFERENCE_PREFIXES } from '@/lib/stock/movement-reason'
import { MOVEMENT_SEARCH_MIN, sanitizeMovementSearch } from '@/lib/stock/movement-label'
import { normalize } from '@/lib/utils/normalize'

// GET /api/stock/movements?shop_ids=id1,id2&type=in&from=2026-01-01&to=2026-12-31[&product_id=…&limit=10&q=…]
// Droit : voir « Mouvements » ou voir « Stock » (la fiche produit montre les derniers mouvements) dans la boutique.
// product_id : historique d'un seul produit (fiche produit, onglet Mouvements filtré) ; limit : 1 à 500.
// kind : filtre simple de l'onglet Mouvements. Sans `kind` : TOUS les mouvements, quel que soit leur type.
//        Les quatre catégories se partagent tous les mouvements, sans trou ni doublon :
//          transfer   = motif « Transfert … » (envoyé ou reçu), quel que soit le type ;
//          sale       = ventes ;
//          in         = entrées (réassort, réception fournisseur, stock initial, retour d'une vente annulée…) ;
//          adjustment = TOUT LE RESTE (inventaire, perte, dommage, expiration, correction, sortie manuelle, et
//                       tout type ajouté plus tard) — un mouvement rare n'est jamais visible seulement dans « Tous ».
// q    : UNE recherche — nom ou code (SKU / code-barres) du produit, nom de l'employé, numéro de vente, référence
//        de transfert ou de bon de commande, fournisseur. Elle s'ajoute aux autres filtres, sans les remplacer.
const COLUMNS = 'id, type, quantity, previous_qty, new_qty, reason, notes, created_at, product_id, performed_by, shop_id, count_session_id'
const ID_CHUNK = 120
const MAX_PRODUCT_CHUNKS = 12

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids')
    if (!shopIdsParam) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Boutiques dont l'utilisateur est membre ET où son rôle voit les mouvements
    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowedIds: string[] = []
    for (const m of members || []) {
      if (await canViewFeature(supabase, m.role, m.shop_id, 'movements') || await canViewFeature(supabase, m.role, m.shop_id, 'stock')) allowedIds.push(m.shop_id)
    }
    if (!allowedIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 500))

    const typeFilter = searchParams.get('type')
    const kind = searchParams.get('kind')
    if (kind && !['transfer', 'sale', 'in', 'adjustment'].includes(kind)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const productId = searchParams.get('product_id')
    if (productId && !/^[0-9a-f-]{36}$/i.test(productId)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const from = searchParams.get('from')
    const to   = searchParams.get('to')

    // Tous les filtres hors recherche ; `search` = conditions « l'une OU l'autre » de la recherche
    const NOT_TRANSFER = 'reason.is.null,reason.not.ilike.Transfert %'
    const build = (search?: string) => {
      let query = admin
        .from('stock_movements')
        .select(COLUMNS)
        .in('shop_id', allowedIds)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (typeFilter) query = query.eq('type', typeFilter)
      if (kind === 'transfer') query = query.ilike('reason', 'Transfert %')
      else if (kind === 'sale' || kind === 'in') query = query.eq('type', kind).or(NOT_TRANSFER)
      else if (kind === 'adjustment') query = query.not('type', 'in', '(in,sale)').or(NOT_TRANSFER)
      if (productId) query = query.eq('product_id', productId)
      if (from) query = query.gte('created_at', `${from}T00:00:00`)
      if (to)   query = query.lte('created_at', `${to}T23:59:59`)
      if (search) query = query.or(search)
      return query
    }

    let rows: any[] = []
    const q = sanitizeMovementSearch(searchParams.get('q'))
    if (q.length >= MOVEMENT_SEARCH_MIN) {
      // Produits et employés : comparés sans accents ni majuscules (« cafe » trouve « Café »), comme partout
      // ailleurs dans l'application ; références : cherchées dans le motif, après son début fixe.
      const needle = normalize(q)
      const [products, people] = await Promise.all([searchableProducts(admin, allowedIds), searchablePeople(admin, allowedIds)])
      const productIds = products.filter(p => normalize(p.name || '').includes(needle) || normalize(p.sku || '').includes(needle)).map(p => p.id)
      const peopleIds = people.filter(p => normalize(p.full_name || '').includes(needle)).map(p => p.id).slice(0, ID_CHUNK)
      const always = REASON_REFERENCE_PREFIXES.map(prefix => `reason.ilike.${prefix}%${q}%`)
      if (peopleIds.length) always.push(`performed_by.in.(${peopleIds.join(',')})`)
      const chunks: string[][] = []
      for (let i = 0; i < productIds.length && chunks.length < MAX_PRODUCT_CHUNKS; i += ID_CHUNK) chunks.push(productIds.slice(i, i + ID_CHUNK))
      const searches = chunks.length
        ? chunks.map((ids, i) => [...(i === 0 ? always : []), `product_id.in.(${ids.join(',')})`].join(','))
        : [always.join(',')]
      const results = await Promise.all(searches.map(s => build(s)))
      const byId = new Map<string, any>()
      for (const r of results) {
        if (r.error) throw r.error
        for (const row of r.data || []) byId.set(row.id, row)
      }
      rows = Array.from(byId.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)).slice(0, limit)
    } else {
      const { data, error } = await build()
      if (error) throw error
      rows = data || []
    }

    // Enrich with product names and performer names
    const productIds  = Array.from(new Set(rows.map((r: any) => r.product_id).filter(Boolean))) as string[]
    const performerIds = Array.from(new Set(rows.map((r: any) => r.performed_by).filter(Boolean))) as string[]

    const [productRows, profileRows] = await Promise.all([
      inChunks(productIds, ids => admin.from('products').select('id, name, unit, quantity').in('id', ids)),
      inChunks(performerIds, ids => admin.from('profiles').select('id, full_name').in('id', ids)),
    ])

    const productMap: Record<string, { name: string; unit: string; quantity: number }> = {}
    for (const p of productRows) productMap[p.id] = p

    const profileMap: Record<string, string> = {}
    for (const p of profileRows) profileMap[p.id] = p.full_name

    const movements = rows.map((r: any) => ({
      id: r.id,
      shop_id: r.shop_id,
      type: r.type,
      quantity: r.quantity,
      previous_qty: r.previous_qty ?? null,
      new_qty: r.new_qty ?? null,
      reason: r.reason,
      notes: r.notes,
      created_at: r.created_at,
      // Écart constaté pendant un inventaire physique (séance de comptage), pas une correction isolée
      inventory_count: !!r.count_session_id,
      // product_id lets the client group by the actual product instead of
      // by name — two different products can legitimately share a name
      // (duplicate manual entries, a name reused after a delete/recreate),
      // which silently merged their restock/adjustment history together.
      product_id: r.product_id || null,
      product_name: productMap[r.product_id]?.name || null,
      product_unit: productMap[r.product_id]?.unit || null,
      product_current_qty: productMap[r.product_id]?.quantity ?? null,
      performed_by_name: r.performed_by ? (profileMap[r.performed_by] || null) : null,
    }))

    return NextResponse.json({ movements })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** Lecture par paquets : une longue liste d'identifiants ne tient pas dans une seule adresse. */
async function inChunks(ids: string[], read: (ids: string[]) => any): Promise<any[]> {
  const parts: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) parts.push(ids.slice(i, i + ID_CHUNK))
  const results = await Promise.all(parts.map(part => read(part)))
  return results.flatMap((r: any) => r.data || [])
}

/** Produits des boutiques (archivés compris : leurs mouvements restent dans l'historique), nom et code seulement. */
async function searchableProducts(admin: any, shopIds: string[]): Promise<{ id: string; name: string | null; sku: string | null }[]> {
  const all: any[] = []
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await admin.from('products').select('id, name, sku').in('shop_id', shopIds).order('id').range(offset, offset + 999)
    if (error) throw error
    all.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return all
}

/** Personnes qui ont pu faire un mouvement dans ces boutiques : leurs membres, actuels ou anciens. */
async function searchablePeople(admin: any, shopIds: string[]): Promise<{ id: string; full_name: string | null }[]> {
  const { data: members } = await admin.from('shop_members').select('user_id').in('shop_id', shopIds)
  const ids = Array.from(new Set((members || []).map((m: any) => m.user_id).filter(Boolean))) as string[]
  if (!ids.length) return []
  return inChunks(ids, part => admin.from('profiles').select('id, full_name').in('id', part))
}
