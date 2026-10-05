import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { validateSale } from '@/lib/api/sale-validation'
import { checkRateLimit } from '@/lib/rate-limit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/sales/checkout — checkout atomique en ligne. Résout/crée le
// client, insère vente + articles + paiement(s), renvoie la vente complète
// (sale_items + customers imbriqués) pour le reçu — tout en un seul appel
// RPC SECURITY DEFINER (complete_sale, migration 109), à la place de 6
// allers-retours séquentiels. Le chemin hors-ligne n'est pas concerné.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited

  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const {
      shop_id, customer_id, customer_name, customer_phone,
      subtotal, discount, tax, total,
      payment_method, notes, paystack_reference, client_request_id,
      items, payments, due_date,
    } = await request.json()

    if (!shop_id || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }
    if (!client_request_id) {
      return NextResponse.json({ error: t('client_request_id_required') }, { status: 400 })
    }

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'new_sale'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    // Contrôle serveur (lot 1, 5 oct. 2026) : chaque ligne au moins au prix en
    // vigueur, remise soumise au droit « discount », totaux recalculés —
    // l'écran de caisse n'est plus la seule garde.
    const check = await validateSale(admin, shop_id, items, { subtotal, discount: discount ?? 0, tax: tax ?? 0, total }, {
      discountAllowed: await canWriteFeature(supabase, role, shop_id, 'discount'),
    })
    if (!check.ok) {
      return NextResponse.json({ error: t(check.error as any, check.params as any), code: check.error }, { status: check.error === 'discount_not_allowed' ? 403 : 400 })
    }

    const { data, error } = await admin.rpc('complete_sale', {
      p_shop_id: shop_id,
      // Jamais un cashier_id venant du corps de la requête — la RLS
      // directe imposait cashier_id = auth.uid(), SECURITY DEFINER la
      // contourne entièrement donc c'est cette route qui doit l'imposer.
      p_cashier_id: user.id,
      p_customer_id: customer_id || null,
      p_customer_name: customer_name || null,
      p_customer_phone: customer_phone || null,
      p_subtotal: subtotal,
      p_discount: discount ?? 0,
      p_tax: tax ?? 0,
      p_total: total,
      p_payment_method: payment_method,
      p_notes: notes || null,
      p_paystack_reference: paystack_reference || null,
      p_client_request_id: client_request_id,
      p_items: items,
      p_payments: payments || [],
      p_due_date: due_date || null,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
