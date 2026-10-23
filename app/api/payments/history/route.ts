import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { shopsWithView } from '@/lib/api/role-permissions'

// GET /api/payments/history?shop_id=xxx&customer_id=yyy
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    const customer_id = searchParams.get('customer_id')
    if (!shop_id || !customer_id) {
      return NextResponse.json({ error: t('shop_customer_ids_required') }, { status: 400 })
    }


    const supabase = await createClient() as any
    // getUser() : jeton vérifié par le serveur d'authentification (getSession() ne fait que lire le cookie)
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const admin = await createAdminClient() as any

    // Parallel: droit + sales query (optimistic — discard sales if the check fails)
    const [access, salesRes] = await Promise.all([
      shopsWithView(supabase, user.id, [shop_id], ['payments']),
      admin
        .from('sales')
        .select('id, sale_number, created_at, total, amount_paid, balance, payment_status, payment_method, cashier_id, sale_status, notes, sale_items(product_name, quantity, unit_price, subtotal)')
        .eq('customer_id', customer_id)
        .eq('shop_id', shop_id)
        // Ventes à crédit ET reprises de dette (migration 168)
        .in('sale_status', ['active', 'opening'])
        .order('created_at', { ascending: false }),
    ])

    // Droit « Crédits » dans CETTE boutique, avec le rôle de la personne DANS la boutique. Avant : aucun droit de
    // fonction, et repli sur le rôle global du profil (profiles.role) — supprimé (règle : jamais le rôle global).
    if (!access.ids.includes(shop_id)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const sales: any[] = salesRes.data || []
    if (!sales.length) return NextResponse.json({ sales: [], payments: [] })

    const saleIds = sales.map((s: any) => s.id)
    const cashierIds = Array.from(new Set(sales.map((s: any) => s.cashier_id).filter(Boolean))) as string[]

    // Parallel: payments + profiles for cashiers (likely the same people as received_by)
    const [paymentsRes, cashierProfilesRes] = await Promise.all([
      admin
        .from('payments')
        .select('id, sale_id, amount, method, reference, notes, paid_at, received_by, is_cancelled, cancelled_at, cancel_reason, edited_at, is_write_off')
        .in('sale_id', saleIds)
        .order('paid_at', { ascending: false }),
      cashierIds.length > 0
        ? admin.from('profiles').select('id, full_name').in('id', cashierIds)
        : Promise.resolve({ data: [] }),
    ])

    const payments: any[] = paymentsRes.data || []
    const profileMap: Record<string, string> = {}
    for (const p of (cashierProfilesRes.data || [])) profileMap[p.id] = p.full_name

    // Fetch any received_by profiles not already loaded (usually same team → often 0 extra fetches)
    const missingIds = Array.from(new Set(
      payments.map((p: any) => p.received_by).filter((id: any) => id && !profileMap[id])
    )) as string[]
    if (missingIds.length > 0) {
      const { data: extra } = await admin.from('profiles').select('id, full_name').in('id', missingIds)
      for (const p of (extra || [])) profileMap[p.id] = p.full_name
    }

    const enrichedSales = sales.map((s: any) => ({
      ...s,
      cashier_name: s.cashier_id ? (profileMap[s.cashier_id] || null) : null,
    }))
    const enrichedPayments = payments.map((p: any) => ({
      ...p,
      received_by_name: p.received_by ? (profileMap[p.received_by] || null) : null,
    }))

    return NextResponse.json({ sales: enrichedSales, payments: enrichedPayments })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
