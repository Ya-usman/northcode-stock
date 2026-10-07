import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { checkContactRows, summarizeContacts, CUSTOMER_FIELDS, SUPPLIER_FIELDS, type ContactKind, type ContactRawRow, type ContactReport } from '@/lib/import/contacts-import'
import { IMPORT_MAX_ROWS } from '@/lib/import/products-import'

// POST /api/customers/import · /api/suppliers/import (7 oct. 2026)
//   { shop_id, rows: [{ line, values }], dry_run? }
// Mêmes règles pour la vérification (dry_run) et l'import : seules les fiches
// NOUVELLES sont créées ; une fiche déjà enregistrée (même numéro ou même nom)
// est laissée telle quelle — réimporter le même fichier ne crée aucun doublon.
// Droit « Clients » (ou « Fournisseurs ») en modification ; journal d'activité.
// Lot 2 : « Montant dû » d'une fiche NOUVELLE → reprise de dette (migration 168),
// avec en plus le droit « Crédits » en modification ; sans ce droit, la fiche est
// importée sans sa dette (signalé sur la ligne).
export async function handleContactImport(request: Request, kind: ContactKind) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const body = await request.json()
    const shopId = body?.shop_id
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!Array.isArray(body?.rows) || body.rows.length === 0) return NextResponse.json({ error: t('no_rows_to_import') }, { status: 400 })
    if (body.rows.length > IMPORT_MAX_ROWS) return NextResponse.json({ error: t('max_import_rows', { max: IMPORT_MAX_ROWS }) }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, kind))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    const canDebt = await canWriteFeature(supabase, role, shopId, 'payments')

    const fields: string[] = kind === 'customers' ? CUSTOMER_FIELDS : SUPPLIER_FIELDS
    const rows: ContactRawRow[] = body.rows.map((r: any, i: number) => {
      const values: Record<string, unknown> = {}
      for (const f of fields) if (r?.values?.[f] !== undefined) values[f] = r.values[f]
      return { line: Number(r?.line) || i + 2, values }
    })

    const admin = await createAdminClient() as any
    const { data: shop } = await admin.from('shops').select('country').eq('id', shopId).maybeSingle()
    // Fiches actuelles (supprimées ou fusionnées exclues), par pages
    const existing: { name: string; phone: string | null }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from(kind).select('name, phone').eq('shop_id', shopId).is('deleted_at', null).range(from, from + 999)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      existing.push(...(data || []))
      if (!data || data.length < 1000) break
    }

    const reports = checkContactRows(kind, rows, existing, shop?.country ?? null)
    // Sans le droit « Crédits » : la fiche reste importable, sa dette non
    if (!canDebt) for (const r of reports) if (r.debt) { r.warnings.push({ code: 'debt_no_permission' }); delete r.debt }
    const strip = (r: ContactReport) => ({ line: r.line, status: r.status, issue: r.issue, params: r.params, warnings: r.warnings, debt: r.debt })
    if (body?.dry_run === true) return NextResponse.json({ dry_run: true, summary: summarizeContacts(reports), rows: reports.map(strip) })

    // ── Import : les fiches nouvelles, par paquets de 200 ─────────────────────
    const toCreate = reports.filter(r => r.status === 'new' && r.record)
    const idOf = new Map<ContactReport, string>()
    let inserted = 0
    for (let i = 0; i < toCreate.length; i += 200) {
      const chunk = toCreate.slice(i, i + 200)
      const payload = chunk.map(r => ({ shop_id: shopId, ...r.record! }))
      const { data, error } = await admin.from(kind).insert(payload).select('id, name')
      if (!error) {
        // Noms uniques dans le fichier (doublons refusés) : on retrouve chaque ligne par son nom
        const byName = new Map<string, string>((data || []).map((d: any) => [d.name, d.id]))
        for (const r of chunk) { const id = byName.get(r.record!.name); if (id) idOf.set(r, id) }
        inserted += (data || []).length
        continue
      }
      for (let k = 0; k < payload.length; k++) { // repli ligne par ligne : l'erreur reste sur sa ligne
        const one = await admin.from(kind).insert(payload[k]).select('id').single()
        if (one.error) Object.assign(chunk[k], { status: 'error', issue: 'insert_failed', params: { name: chunk[k].record!.name } })
        else { inserted++; idOf.set(chunk[k], one.data.id) }
      }
    }

    // ── Dettes de départ des fiches créées → reprises de dette (6 à la fois) ──
    const withDebt = toCreate.filter(r => r.status === 'new' && r.debt && idOf.has(r))
    let debtsCreated = 0, debtsTotal = 0
    const ip = getClientIp(request)
    const createDebt = async (r: ContactReport) => {
      const partyId = idOf.get(r)!
      const common = { p_shop_id: shopId, p_amount: r.debt!.amount, p_debt_date: r.debt!.date, p_note: null, p_actor: user.id, p_client_request_id: `import:${partyId}` }
      const { data, error } = kind === 'customers'
        ? await admin.rpc('create_customer_opening_balance', { ...common, p_customer_id: partyId, p_due_date: null })
        : await admin.rpc('create_supplier_opening_balance', { ...common, p_supplier_id: partyId })
      if (error || !data) { r.warnings.push({ code: 'debt_failed', params: { amount: r.debt!.amount } }); return }
      debtsCreated++; debtsTotal += r.debt!.amount
      await writeAuditLog({
        action: 'debt.opening_created', actor_id: user.id, actor_email: user.email, shop_id: shopId,
        target_id: data.id, target_type: kind === 'customers' ? 'sale' : 'purchase_order',
        metadata: { kind: kind === 'customers' ? 'customer' : 'supplier', source: 'import', number: data.number, amount: r.debt!.amount, party_id: partyId, party_name: r.record!.name, debt_date: r.debt!.date },
        ip,
      })
    }
    for (let i = 0; i < withDebt.length; i += 6) await Promise.all(withDebt.slice(i, i + 6).map(createDebt))

    const summary = { ...summarizeContacts(reports), inserted, debts_created: debtsCreated, debts_created_total: debtsTotal }
    await writeAuditLog({
      action: kind === 'customers' ? 'customer.import' : 'supplier.import', actor_id: user.id, actor_email: user.email, shop_id: shopId,
      target_type: 'shop', target_id: shopId,
      metadata: { inserted, rows: summary.total, already_registered: summary.exists, errors: summary.errors, debts_created: debtsCreated, debts_total: debtsTotal },
      ip,
    })
    return NextResponse.json({ inserted, summary, rows: reports.map(strip) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
