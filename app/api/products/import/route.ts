import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { shopProductKeys } from '@/lib/api/new-product'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewCost, canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { checkRows, summarize, IMPORT_FIELDS, IMPORT_MAX_ROWS, type RawRow, type RowReport } from '@/lib/import/products-import'

// POST /api/products/import — import de produits (lot 1, 7 oct. 2026).
//   { shop_id, rows: [{ line, values: { name, selling_price, … } }], dry_run? }
// Mêmes règles pour l'aperçu (dry_run) et l'import (lib/import/products-import.ts) :
// seules les lignes « nouvelles » sont créées ; un produit déjà en stock (même nom
// ou même code-barres) est laissé tel quel — réimporter le même fichier ne crée
// jamais de doublon. Un code-barres pris par un AUTRE produit est une erreur de la
// ligne, pas de tout l'import. Chaque produit créé avec du stock reçoit son
// mouvement « Stock initial » ET son lot initial (date de péremption facultative,
// coût seulement s'il est donné) : jamais de stock sans lot. Si le mouvement ou le
// lot ne peut pas être enregistré, les produits du paquet sont retirés et signalés.
// Ancien format (lignes à plat) encore accepté.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const shopId = body?.shop_id
    const dryRun = body?.dry_run === true
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!Array.isArray(body?.rows) || body.rows.length === 0) return NextResponse.json({ error: t('no_rows_to_import') }, { status: 400 })
    if (body.rows.length > IMPORT_MAX_ROWS) return NextResponse.json({ error: t('max_import_rows', { max: IMPORT_MAX_ROWS }) }, { status: 400 })

    // Import = « Produits / Stock » en modification (règle unique, lot 1)
    // Contrôle commun à toutes les routes (propriétaire sans ligne de membre compris), comme « Ajouter un produit »
    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, 'stock'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    // Lignes : { line, values } ; ancien format (objet à plat, ligne 1 = en-têtes) converti
    const rows: RawRow[] = body.rows.map((r: any, i: number) => {
      if (r && typeof r === 'object' && r.values && typeof r.values === 'object') {
        const values: RawRow['values'] = {}
        for (const f of IMPORT_FIELDS) if (r.values[f] !== undefined) values[f] = r.values[f]
        return { line: Number(r.line) || i + 2, values }
      }
      const values: RawRow['values'] = {}
      for (const f of IMPORT_FIELDS) if (r?.[f] !== undefined) values[f] = r[f]
      return { line: i + 2, values }
    })

    const admin = createAdminClient() as any
    // Produits de la boutique (nom, code-barres, actif ou archivé), par pages
    const keys = await shopProductKeys(admin, shopId)
    if (keys.error) return NextResponse.json({ error: t('product_create_failed') }, { status: 500 })
    const existing = keys.data

    // Ajout rapide (saisie à la main) : jamais de « ligne d'exemple » écartée ; import de fichier : inchangé
    const quickAdd = body?.source === 'quick_add'
    const reports: RowReport[] = checkRows(rows, existing, undefined, { examples: !quickAdd })
    // Catégorie par ligne (ajout rapide) : seulement une catégorie de CETTE boutique, sinon ligne à corriger
    const categoryOf = new Map<number, string>()
    body.rows.forEach((r: any, i: number) => { if (typeof r?.category_id === 'string' && r.category_id) categoryOf.set(rows[i].line, r.category_id) })
    if (categoryOf.size) {
      const { data: cats } = await admin.from('categories').select('id').eq('shop_id', shopId).in('id', Array.from(new Set(categoryOf.values())))
      const valid = new Set(((cats || []) as { id: string }[]).map(c => c.id))
      for (const r of reports) if (r.status === 'new' && categoryOf.has(r.line) && !valid.has(categoryOf.get(r.line)!)) Object.assign(r, { status: 'error', issue: 'invalid_category' })
    }
    const strip = (r: RowReport) => ({ line: r.line, status: r.status, issue: r.issue, params: r.params, warnings: r.warnings, product_id: r.product_id })
    if (dryRun) return NextResponse.json({ dry_run: true, summary: summarize(reports), rows: reports.map(strip) })

    // ── Import : les lignes nouvelles, par paquets de 200 ─────────────────────
    const toCreate = reports.filter(r => r.status === 'new' && r.product)
    // Colonne « prix d'achat » : prise en compte seulement avec le droit au coût — sinon coût inconnu (produit et lot)
    const seesCost = await canViewCost(supabase, role, shopId)
    if (!seesCost) for (const r of toCreate) { delete (r.product as any).buying_price; if (r.lot) r.lot.cost = null }
    let inserted = 0
    for (let i = 0; i < toCreate.length; i += 200) {
      const chunk = toCreate.slice(i, i + 200)
      const payload = chunk.map(r => ({ shop_id: shopId, ...r.product!, category_id: categoryOf.get(r.line) ?? null, is_active: true }))
      let created: { id: string; idx: number }[] = []
      const { data, error } = await admin.from('products').insert(payload).select('id')
      if (!error) created = (data || []).map((d: any, idx: number) => ({ id: d.id, idx }))
      else {
        // Conflit apparu entre l'aperçu et l'import (code-barres pris entre-temps) : ligne par ligne
        for (let k = 0; k < payload.length; k++) {
          const one = await admin.from('products').insert(payload[k]).select('id').single()
          if (one.error) Object.assign(chunk[k], { status: 'error', issue: /sku/i.test(one.error.message) ? 'exists_sku' : 'insert_failed', params: { name: chunk[k].product!.name } })
          else created.push({ id: one.data.id, idx: k })
        }
      }
      // Stock initial : mouvement + lot, comme l'ajout d'un produit à l'unité
      const withStock = created.filter(c => chunk[c.idx].product!.quantity > 0)
      const movements = withStock.map(c => ({ shop_id: shopId, product_id: c.id, type: 'in', quantity: chunk[c.idx].product!.quantity, reason: 'Stock initial', performed_by: user.id, previous_qty: 0, new_qty: chunk[c.idx].product!.quantity }))
      const lots = withStock.map(c => ({
        shop_id: shopId, product_id: c.id, quantity: chunk[c.idx].product!.quantity, initial_quantity: chunk[c.idx].product!.quantity,
        buying_price: chunk[c.idx].lot?.cost ?? null, expiry_date: chunk[c.idx].lot?.expiry_date ?? null, source: 'backfill', // « Stock initial »
      }))
      let failed: string | null = null
      let movementIds: string[] = []
      if (movements.length) {
        const mv = await admin.from('stock_movements').insert(movements).select('id')
        if (mv.error) failed = mv.error.message
        else movementIds = (mv.data || []).map((m: any) => m.id)
      }
      if (!failed && lots.length) {
        const lt = await admin.from('product_batches').insert(lots)
        if (lt.error) failed = lt.error.message
      }
      if (failed) {
        // Jamais de produit avec du stock sans son lot : les produits avec stock de ce paquet sont retirés
        console.error('[import] stock initial non enregistré, produits du paquet retirés', failed)
        if (movementIds.length) await admin.from('stock_movements').delete().in('id', movementIds)
        await admin.from('products').delete().in('id', withStock.map(c => c.id))
        for (const c of withStock) Object.assign(chunk[c.idx], { status: 'error', issue: 'insert_failed', params: { name: chunk[c.idx].product!.name } })
        created = created.filter(c => !withStock.includes(c))
      }
      inserted += created.length
      for (const c of created) chunk[c.idx].product_id = c.id
    }

    const summary = { ...summarize(reports), inserted }
    await writeAuditLog({
      action: 'product.import', actor_id: user.id, actor_email: user.email, shop_id: shopId,
      target_type: 'shop', target_id: shopId,
      // Noms des produits créés (journal Stock) : 50 au plus, le total reste dans « inserted »
      metadata: { inserted, rows: summary.total, already_in_stock: summary.exists, errors: summary.errors, ignored_examples: summary.ignored, source: quickAdd ? 'quick_add' : 'file',
        product_names: reports.filter(r => r.product_id).slice(0, 50).map(r => r.product!.name) },
      ip: getClientIp(request),
    })
    return NextResponse.json({ inserted, summary, rows: reports.map(strip) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
