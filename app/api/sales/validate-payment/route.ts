import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

    const parsedAmount = Math.min(Number(amount), Number(sale.balance))
    if (parsedAmount <= 0) return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })

    const newAmountPaid = Number(sale.amount_paid) + parsedAmount
    const newBalance = Math.max(0, Number(sale.total) - newAmountPaid)
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'

    // Insert payment record
    await admin.from('payments').insert({
      sale_id,
      amount: parsedAmount,
      method,
      reference: reference || null,
      received_by: user.id,
    })

    // Update sale
    const { error: updateErr } = await admin.from('sales').update({
      amount_paid: newAmountPaid,
      balance: newBalance,
      payment_status: newStatus,
      payment_method: method,
    }).eq('id', sale_id)

    if (updateErr) throw updateErr

    return NextResponse.json({ success: true, message: newBalance <= 0 ? 'Paiement complet' : `Solde restant: ${newBalance}` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
