import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { checkRateLimit } from '@/lib/rate-limit'

// POST /api/sales/checkout — checkout atomique en ligne. Résout/crée le
// client, insère vente + articles + paiement(s), renvoie la vente complète
// (sale_items + customers imbriqués) pour le reçu — tout en un seul appel
// RPC SECURITY DEFINER (complete_sale, migration 109), à la place de 6
// allers-retours séquentiels. Le chemin hors-ligne n'est pas concerné.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited

  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const {
      shop_id, customer_id, customer_name, customer_phone,
      subtotal, discount, tax, total,
      payment_method, notes, paystack_reference, client_request_id,
      items, payments,
    } = await request.json()

    if (!shop_id || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    }
    if (!client_request_id) {
      return NextResponse.json({ error: 'client_request_id requis' }, { status: 400 })
    }

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'new_sale'))) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
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
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true, ...data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
