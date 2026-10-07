import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { parsePhone } from '@/lib/import/contacts-import'
import { normalizeText } from '@/lib/import/products-import'
import { samePhone } from '@/lib/phone/compare'

// Reprise de dette (migration 168) — droit « Crédits » en modification.
//   POST   { shop_id, kind: 'customer'|'supplier', party_id? | new_party?: { name, phone? },
//            amount, debt_date (AAAA-MM-JJ, pas dans le futur), due_date?, note?, client_request_id }
//   DELETE ?shop_id=&kind=&id=   annule une reprise tant que rien n'a été remboursé / payé
// Côté client : vente au statut 'opening' (REP-0001) ; côté fournisseur : bon de
// commande « reçu » marqué is_opening_balance (REP-F-0001). Jamais dans le CA.

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

async function authorize(request: Request, shopId: string | null) {
  const t = getApiTranslator(request)
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (!shopId) return { error: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  if (!role || !(await canWriteFeature(supabase, role, shopId, 'payments'))) {
    return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  }
  return { user, t }
}

export async function POST(request: Request) {
  try {
    const b = await request.json()
    const auth = await authorize(request, b?.shop_id)
    if ('error' in auth) return auth.error
    const { user, t } = auth
    const kind = b.kind === 'supplier' ? 'supplier' : b.kind === 'customer' ? 'customer' : null
    const amount = Number(b.amount)
    if (!kind || !Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const debtDate = typeof b.debt_date === 'string' && DAY_RE.test(b.debt_date) ? b.debt_date : null
    const dueDate = typeof b.due_date === 'string' && DAY_RE.test(b.due_date) ? b.due_date : null
    if (!debtDate) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : ''
    const admin = await createAdminClient() as any
    const table = kind === 'customer' ? 'customers' : 'suppliers'

    // Client / fournisseur : existant, ou nouveau (rattaché à une fiche existante si même numéro ou même nom)
    let partyId: string | null = typeof b.party_id === 'string' ? b.party_id : null
    let partyName = ''
    if (partyId) {
      const { data } = await admin.from(table).select('id, name').eq('id', partyId).eq('shop_id', b.shop_id).is('deleted_at', null).maybeSingle()
      if (!data) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
      partyName = data.name
    } else {
      const name = String(b.new_party?.name ?? '').replace(/\s+/g, ' ').trim()
      if (!name || name.length > 200) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
      const { data: shop } = await admin.from('shops').select('country').eq('id', b.shop_id).maybeSingle()
      const phone = parsePhone(b.new_party?.phone, shop?.country ?? null)
      if (phone.invalid) return NextResponse.json({ error: t('invalid_data'), field: 'phone' }, { status: 400 })
      const { data: existing } = await admin.from(table).select('id, name, phone').eq('shop_id', b.shop_id).is('deleted_at', null)
      const match = (existing || []).find((e: any) => (phone.value && e.phone && samePhone(e.phone, phone.value)) || normalizeText(e.name) === normalizeText(name))
      if (match) { partyId = match.id; partyName = match.name }
      else {
        const { data: created, error } = await admin.from(table).insert({ shop_id: b.shop_id, name, phone: phone.value }).select('id, name').single()
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
        partyId = created.id; partyName = created.name
      }
    }

    const rpc = kind === 'customer'
      ? admin.rpc('create_customer_opening_balance', {
          p_shop_id: b.shop_id, p_customer_id: partyId, p_amount: amount, p_debt_date: debtDate, p_due_date: dueDate,
          p_note: note || null, p_actor: user.id, p_client_request_id: b.client_request_id || null,
        })
      : admin.rpc('create_supplier_opening_balance', {
          p_shop_id: b.shop_id, p_supplier_id: partyId, p_amount: amount, p_debt_date: debtDate,
          p_note: note || null, p_actor: user.id, p_client_request_id: b.client_request_id || null,
        })
    const { data, error } = await rpc
    if (error) {
      const known = error.code === 'P0021' ? 'opening_future_date' : error.code === 'P0020' ? 'invalid_data' : null
      return NextResponse.json({ error: known ? t(known as any) : error.message, code: error.code }, { status: 400 })
    }
    if (!data?.already_existed) {
      await writeAuditLog({
        action: 'debt.opening_created', actor_id: user.id, actor_email: user.email, shop_id: b.shop_id,
        target_id: data.id, target_type: kind === 'customer' ? 'sale' : 'purchase_order',
        metadata: { kind, number: data.number, amount, party_id: partyId, party_name: partyName, debt_date: debtDate, due_date: dueDate, note: note || null },
        ip: getClientIp(request),
      })
    }
    return NextResponse.json({ success: true, id: data.id, number: data.number, party_id: partyId, party_name: partyName })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url)
    const shopId = url.searchParams.get('shop_id')
    const kind = url.searchParams.get('kind')
    const id = url.searchParams.get('id')
    const auth = await authorize(request, shopId)
    if ('error' in auth) return auth.error
    const { user, t } = auth
    if (!id || (kind !== 'customer' && kind !== 'supplier')) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const admin = await createAdminClient() as any

    let number = ''
    let details: Record<string, unknown> = {}
    if (kind === 'customer') {
      const { data: sale } = await admin.from('sales').select('id, sale_number, sale_status, amount_paid, total, customer_id, created_at, notes, customers(name)').eq('id', id).eq('shop_id', shopId).maybeSingle()
      if (!sale || sale.sale_status !== 'opening') return NextResponse.json({ error: t('invalid_data') }, { status: 404 })
      if (Number(sale.amount_paid) > 0) return NextResponse.json({ error: t('opening_already_paid') }, { status: 409 })
      // Annulation (retire la dette du client) puis suppression : une reprise annulée ne doit
      // jamais réapparaître comme « vente annulée » dans l'Historique des ventes. La trace
      // complète reste dans le journal d'activité (debt.opening_cancelled).
      const { error } = await admin.rpc('cancel_sale', { p_sale_id: id, p_cancelled_by: user.id, p_reason: 'Reprise de dette annulée' })
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      const { error: delErr } = await admin.rpc('delete_sale', { p_sale_id: id, p_user_id: user.id })
      if (delErr) console.error('[opening-balances] suppression après annulation', delErr.message)
      number = sale.sale_number
      details = { amount: Number(sale.total), party_id: sale.customer_id, party_name: sale.customers?.name ?? null, debt_date: String(sale.created_at).slice(0, 10), note: sale.notes ?? null }
    } else {
      const { data, error } = await admin.rpc('cancel_supplier_opening_balance', { p_po_id: id, p_shop_id: shopId })
      if (error) return NextResponse.json({ error: error.code === 'P0023' ? t('opening_already_paid') : error.message }, { status: error.code === 'P0023' ? 409 : 400 })
      number = data?.number ?? ''
    }
    await writeAuditLog({
      action: 'debt.opening_cancelled', actor_id: user.id, actor_email: user.email, shop_id: shopId,
      target_id: id, target_type: kind === 'customer' ? 'sale' : 'purchase_order', metadata: { kind, number, ...details }, ip: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
