import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { checkRows, summarize, IMPORT_FIELDS, IMPORT_MAX_ROWS, type RawRow, type RowReport } from '@/lib/import/products-import'

// POST /api/products/import — import de produits (lot 1, 7 oct. 2026).
//   { shop_id, rows: [{ line, values: { name, selling_price, … } }], dry_run? }
// Mêmes règles pour l'aperçu (dry_run) et l'import (lib/import/products-import.ts) :
// seules les lignes « nouvelles » sont créées ; un produit déjà en stock (même nom
// ou même code-barres) est laissé tel quel — réimporter le même fichier ne crée
// jamais de doublon. Un code-barres pris par un AUTRE produit est une erreur de la
// ligne, pas de tout l'import. Chaque produit créé avec du stock reçoit son
// mouvement « Stock initial ». Ancien format (lignes à plat) encore accepté.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const shopId = body?.shop_id
    const dryRun = body?.dry_run === true
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!Array.isArray(body?.rows) || body.rows.length === 0) return NextResponse.json({ error: t('no_rows_to_import') }, { status: 400 })
    if (body.rows.length > IMPORT_MAX_ROWS) return NextResponse.json({ error: t('max_import_rows', { max: IMPORT_MAX_ROWS }) }, { status: 400 })

    // Import = « Produits / Stock » en modification (règle unique, lot 1)
    const { data: memberRow } = await supabase.from('shop_members').select('role')
      .eq('shop_id', shopId).eq('user_id', user.id).eq('is_active', true).maybeSingle()
    if (!memberRow || !(await canWriteFeature(supabase, memberRow.role, shopId, 'stock'))) {
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
    // Produits actuels de la boutique (nom, code-barres), par pages
    const existing: { name: string; sku: string | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('products').select('name, sku').eq('shop_id', shopId).range(from, from + 999)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      existing.push(...(data || []))
      if (!data || data.length < 1000) break
    }

    const reports: RowReport[] = checkRows(rows, existing)
    const strip = (r: RowReport) => ({ line: r.line, status: r.status, issue: r.issue, params: r.params, warnings: r.warnings })
    if (dryRun) return NextResponse.json({ dry_run: true, summary: summarize(reports), rows: reports.map(strip) })

    // ── Import : les lignes nouvelles, par paquets de 200 ─────────────────────
    const toCreate = reports.filter(r => r.status === 'new' && r.product)
    let inserted = 0
    for (let i = 0; i < toCreate.length; i += 200) {
      const chunk = toCreate.slice(i, i + 200)
      const payload = chunk.map(r => ({ shop_id: shopId, ...r.product!, is_active: true }))
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
      inserted += created.length
      // Mouvement « Stock initial » — comme l'ajout d'un produit à l'unité
      const movements = created
        .map(c => ({ id: c.id, qty: chunk[c.idx].product!.quantity }))
        .filter(m => m.qty > 0)
        .map(m => ({ shop_id: shopId, product_id: m.id, type: 'in', quantity: m.qty, reason: 'Stock initial', performed_by: user.id, previous_qty: 0, new_qty: m.qty }))
      if (movements.length) {
        const mv = await admin.from('stock_movements').insert(movements)
        if (mv.error) console.error('[import] mouvements « Stock initial » non enregistrés', mv.error.message)
      }
    }

    const summary = { ...summarize(reports), inserted }
    await writeAuditLog({
      action: 'product.import', actor_id: user.id, actor_email: user.email, shop_id: shopId,
      target_type: 'shop', target_id: shopId,
      metadata: { inserted, rows: summary.total, already_in_stock: summary.exists, errors: summary.errors, ignored_examples: summary.ignored },
      ip: getClientIp(request),
    })
    return NextResponse.json({ inserted, summary, rows: reports.map(strip) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
