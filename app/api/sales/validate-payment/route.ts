import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { sale_id, amount, method, reference } = await request.json()
    if (!sale_id || !amount || !method) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Verify caller has access to the sale's shop before the atomic RPC
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('shop_id, sale_status')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: 'Vente annulée' }, { status: 400 })

    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!memberRow) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Atomic: lock sale row, cap amount, insert payment, update payment_method
    const { data: result, error: rpcErr } = await admin.rpc('validate_payment', {
      p_sale_id:   sale_id,
      p_amount:    Number(amount),
      p_method:    method,
      p_reference: reference || null,
      p_user_id:   user.id,
    })
    if (rpcErr) throw rpcErr

    const row = Array.isArray(result) ? result[0] : result
    const newBalance = Number(row?.new_balance ?? 0)
    return NextResponse.json({ success: true, message: newBalance <= 0 ? 'Paiement complet' : `Solde restant: ${newBalance}` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
