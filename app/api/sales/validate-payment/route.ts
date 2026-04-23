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
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { sale_id, amount, method, reference } = await request.json()
    if (!sale_id || !amount || !method) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('*')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: 'Vente introuvable' }, { status: 404 })
    if (sale.sale_status === 'cancelled') return NextResponse.json({ error: 'Vente annulée' }, { status: 400 })

    // Verify caller has access to the sale's shop
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

    const parsedAmount = Math.min(Number(amount), Number(sale.balance))
    if (parsedAmount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })

    // Insert payment — DB trigger (after_payment_insert) updates amount_paid + payment_status automatically.
    // Do NOT manually update amount_paid here or it gets doubled.
    const { error: payErr } = await admin.from('payments').insert({
      sale_id,
      amount: parsedAmount,
      method,
      reference: reference || null,
      received_by: user.id,
    })
    if (payErr) throw payErr

    // Only update payment_method (trigger doesn't touch it)
    await admin.from('sales').update({ payment_method: method }).eq('id', sale_id)

    const newBalance = Math.max(0, Number(sale.balance) - parsedAmount)
    return NextResponse.json({ success: true, message: newBalance <= 0 ? 'Paiement complet' : `Solde restant: ${newBalance}` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
