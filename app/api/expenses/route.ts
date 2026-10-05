import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { validateExpenseInput } from '@/lib/validations/expense'
import { RECEIPT_BUCKET, isReceiptPathOfShop } from '@/lib/expenses/receipts'

// Dépenses PAR LE SERVEUR (lot 2 permissions, 5 oct. 2026) : création et
// modification. Droit « Dépenses » en modification (règle unique). Contrôles
// partagés : lib/validations/expense.ts. Clé d'idempotence `client_request_id`
// (synchronisation hors ligne, migration 156) : une même saisie renvoyée
// deux fois ne crée qu'une dépense.

async function authorize(request: Request, shop_id: string) {
  const t = getApiTranslator(request)
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (!shop_id) return { error: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shop_id)
  if (!role || !(await canWriteFeature(supabase, role, shop_id, 'expenses'))) {
    return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  }
  return { user, t }
}

const isPastIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && Date.parse(v) <= Date.now() + 5 * 60_000

// POST /api/expenses — { shop_id, amount, description, date, category, payment_method,
//   is_recurring?, recurrence?, recurrence_day?, receipt_url?, client_request_id?, created_at? }
export async function POST(request: Request) {
  try {
    const body = await request.json()
    const auth = await authorize(request, body?.shop_id)
    if ('error' in auth) return auth.error
    const check = validateExpenseInput(body)
    if (!check.ok) return NextResponse.json({ error: auth.t(check.error as any), code: check.error }, { status: 400 })
    const v = check.value
    if (v.receipt_url && !isReceiptPathOfShop(v.receipt_url, body.shop_id)) return NextResponse.json({ error: auth.t('invalid_data') }, { status: 400 })
    const admin = await createAdminClient() as any

    // Idempotence (hors ligne) : la dépense existe déjà → on la renvoie telle quelle
    const clientRequestId = typeof body.client_request_id === 'string' && body.client_request_id.length <= 80 ? body.client_request_id : null
    if (clientRequestId) {
      const { data: existing } = await admin.from('expenses').select('*').eq('shop_id', body.shop_id).eq('client_request_id', clientRequestId).maybeSingle()
      if (existing) return NextResponse.json({ expense: existing, duplicate: true })
    }

    const row: Record<string, unknown> = {
      shop_id: body.shop_id, ...v, template_id: null, created_by: auth.user.id,
      next_due_at: v.is_recurring ? v.date : null,
      client_request_id: clientRequestId,
    }
    // Saisie hors ligne : on garde l'heure réelle de la dépense (jamais future)
    if (clientRequestId && isPastIso(body.created_at)) row.created_at = body.created_at

    const { data, error } = await admin.from('expenses').insert(row).select().single()
    if (error) {
      if (error.code === '23505' && clientRequestId) {
        const { data: raced } = await admin.from('expenses').select('*').eq('shop_id', body.shop_id).eq('client_request_id', clientRequestId).maybeSingle()
        if (raced) return NextResponse.json({ expense: raced, duplicate: true })
      }
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    await writeAuditLog({
      action: 'expense.create', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: data.id, target_type: 'expense',
      metadata: { amount: data.amount, category: data.category, description: data.description, date: data.date, is_recurring: data.is_recurring, offline: !!clientRequestId },
      ip: getClientIp(request),
    })
    return NextResponse.json({ expense: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/expenses — { id, shop_id, ...mêmes champs }
export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const auth = await authorize(request, body?.shop_id)
    if ('error' in auth) return auth.error
    if (!body.id) return NextResponse.json({ error: auth.t('invalid_data') }, { status: 400 })
    const check = validateExpenseInput(body)
    if (!check.ok) return NextResponse.json({ error: auth.t(check.error as any), code: check.error }, { status: 400 })
    const v = check.value
    if (v.receipt_url && !isReceiptPathOfShop(v.receipt_url, body.shop_id)) return NextResponse.json({ error: auth.t('invalid_data') }, { status: 400 })
    const admin = await createAdminClient() as any
    const { data: before } = await admin.from('expenses').select('*').eq('id', body.id).eq('shop_id', body.shop_id).maybeSingle()
    if (!before) return NextResponse.json({ error: auth.t('expense_not_found') }, { status: 404 })

    // Modèle récurrent déjà avancé : on garde son prochain échéancier, sinon
    // une sauvegarde sans changement régénérerait une occurrence passée.
    const next_due_at = v.is_recurring ? (before.is_recurring ? (before.next_due_at ?? v.date) : v.date) : null
    const { data, error } = await admin.from('expenses')
      .update({ ...v, next_due_at, updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('shop_id', body.shop_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Ancien justificatif remplacé ou retiré : retiré de l'espace privé
    if (before.receipt_url && before.receipt_url !== data.receipt_url && isReceiptPathOfShop(before.receipt_url, body.shop_id)) {
      await admin.storage.from(RECEIPT_BUCKET).remove([before.receipt_url]).catch(() => {})
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of ['amount', 'description', 'date', 'category', 'payment_method', 'is_recurring'] as const) {
      const a = before[k] ?? null, b = data[k] ?? null
      if (k === 'amount' ? Number(a) !== Number(b) : a !== b) changes[k] = { from: a, to: b }
    }
    if ((before.receipt_url ?? null) !== (data.receipt_url ?? null)) changes.receipt = { from: !!before.receipt_url, to: !!data.receipt_url }
    if (Object.keys(changes).length) {
      await writeAuditLog({ action: 'expense.update', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: data.id, target_type: 'expense', metadata: { description: data.description, changes }, ip: getClientIp(request) })
    }
    return NextResponse.json({ expense: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
