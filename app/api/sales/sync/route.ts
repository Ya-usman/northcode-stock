import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { validateSale } from '@/lib/api/sale-validation'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/sales/sync — enregistre une vente faite HORS LIGNE (file de
// l'appareil), lot 3 permissions (migration 159). Mêmes contrôles que la
// caisse en ligne, en tout ou rien (complete_sale), jamais en double (clé =
// local_id de l'appareil), heure réelle de la vente conservée.
//
// Décision utilisateur (5 oct. 2026) : une vente hors ligne NON CONFORME n'est
// jamais perdue — l'argent est encaissé. Elle est enregistrée et marquée « à
// vérifier » (sales.review_reason : price_below_floor, discount_not_allowed,
// sale_total_mismatch ; stock_shortfall ajouté par la base). Seules les vraies
// erreurs (données invalides, produit ou client d'une autre boutique,
// paiements supérieurs au total) sont refusées et restent sur l'appareil.

const REVIEWABLE = new Set(['price_below_floor', 'discount_not_allowed', 'sale_total_mismatch'])
const MAX_FUTURE_MS = 10 * 60_000

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const s = await request.json().catch(() => null)
    const localId = typeof s?.local_id === 'string' ? s.local_id.trim() : ''
    if (!s?.shop_id || !localId || localId.length > 120 || !Array.isArray(s.items) || !s.items.length) {
      return NextResponse.json({ error: t('invalid_data'), code: 'invalid_data' }, { status: 400 })
    }
    const shopId: string = s.shop_id

    // Celui qui synchronise doit être membre actif de la boutique
    const callerRole = await checkShopRole(supabase, user.id, shopId)
    if (!callerRole) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    // Déjà enregistrée ? (renvoi de l'appareil, ou essai en ligne abouti dont la réponse s'est perdue)
    const onlineKey = localId.startsWith('local-') ? localId.slice(6) : null
    const { data: existing } = await admin.from('sales').select('id').eq('shop_id', shopId)
      .in('client_request_id', onlineKey ? [localId, onlineKey] : [localId]).limit(1).maybeSingle()
    if (existing) {
      const { data: sale } = await admin.from('sales').select('*, sale_items(*), customers(*)').eq('id', existing.id).single()
      return NextResponse.json({ success: true, already_existed: true, sale })
    }

    // Vendeur : celui qui a fait la vente s'il est membre de la boutique, sinon celui qui synchronise
    let cashierId: string = user.id
    let cashierRole: string = callerRole
    if (typeof s.cashier_id === 'string' && s.cashier_id !== user.id) {
      const { data: m } = await admin.from('shop_members').select('role').eq('shop_id', shopId).eq('user_id', s.cashier_id).maybeSingle()
      if (m?.role) { cashierId = s.cashier_id; cashierRole = m.role }
    }

    // Heure réelle de la vente (jamais dans le futur)
    const at = new Date(s.created_at)
    const createdAt = Number.isNaN(at.getTime()) || at.getTime() > Date.now() + MAX_FUTURE_MS ? new Date() : at

    // Lignes : prix d'achat repris de la fiche produit (absent des ventes hors ligne)
    const ids = Array.from(new Set(s.items.map((i: any) => i.product_id).filter(Boolean))) as string[]
    const { data: products } = ids.length ? await admin.from('products').select('id, buying_price').eq('shop_id', shopId).in('id', ids) : { data: [] }
    const cost = new Map<string, number>((products || []).map((p: any) => [p.id, Number(p.buying_price) || 0]))
    const items = s.items.map((i: any) => ({
      product_id: i.product_id || null,
      product_name: String(i.product_name ?? '').slice(0, 300),
      quantity: Number(i.quantity),
      unit_price: Number(i.unit_price),
      original_price: i.original_price ?? null,
      buying_price: i.product_id ? cost.get(i.product_id) ?? 0 : 0,
    }))

    // Paiements (forme actuelle ; anciennes ventes en file : payment_amount)
    const payments = Array.isArray(s.payments)
      ? s.payments.filter((p: any) => Number(p.amount) > 0).map((p: any) => ({ amount: Number(p.amount), method: p.method, reference: p.reference || null }))
      : (s.payment_method !== 'credit' && Number(s.payment_amount) > 0 ? [{ amount: Number(s.payment_amount), method: s.payment_method === 'mixed' ? 'cash' : s.payment_method, reference: s.payment_reference || null }] : [])

    // Contrôles de la caisse en ligne, jugés à l'heure de la vente et avec les droits du vendeur
    const amounts = { subtotal: Number(s.subtotal), discount: Number(s.discount) || 0, tax: Number(s.tax) || 0, total: Number(s.total) }
    const check = await validateSale(admin, shopId, items, amounts, {
      discountAllowed: await canWriteFeature(admin, cashierRole, shopId, 'discount'),
      at: createdAt.toISOString(),
    })
    let reviewReason: string | null = null
    if (!check.ok) {
      if (!REVIEWABLE.has(check.error)) return NextResponse.json({ error: t(check.error as any, check.params as any), code: check.error }, { status: 400 })
      reviewReason = check.error
    }

    const { data, error } = await admin.rpc('complete_sale', {
      p_shop_id: shopId,
      p_cashier_id: cashierId,
      p_customer_id: s.customer_id || null,
      p_customer_name: s.customer_name || null,
      p_customer_phone: s.customer_phone || null,
      p_subtotal: amounts.subtotal,
      p_discount: amounts.discount,
      p_tax: amounts.tax,
      p_total: amounts.total,
      p_payment_method: s.payment_method === 'mixed' && !Array.isArray(s.payments) ? 'cash' : s.payment_method,
      p_notes: s.notes || null,
      p_paystack_reference: null,
      p_client_request_id: localId,
      p_items: items,
      p_payments: payments,
      p_due_date: s.due_date || null,
      p_created_at: createdAt.toISOString(),
      p_receipt_token: s.receipt_token || null,
      p_review_reason: reviewReason,
    })
    if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })

    const sale = data?.sale
    if (!data?.already_existed) {
      await writeAuditLog({
        action: 'sale.offline_synced',
        shop_id: shopId,
        actor_id: user.id,
        actor_email: user.email,
        target_id: sale?.id ?? null,
        target_type: 'sale',
        metadata: {
          sale_number: sale?.sale_number ?? null,
          offline_reason: typeof s.offline_reason === 'string' ? s.offline_reason.slice(0, 40) : null,
          sold_at: createdAt.toISOString(),
          delay_minutes: Math.round((Date.now() - createdAt.getTime()) / 60_000),
          cashier_id: cashierId,
          review_reason: sale?.review_reason ?? null,
        },
        ip: getClientIp(request),
      })
    }
    return NextResponse.json({ success: true, already_existed: !!data?.already_existed, sale })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
