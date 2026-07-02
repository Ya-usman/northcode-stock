import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

// POST /api/payments — record FIFO repayment for a customer's unpaid sales
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited

  try {
    const supabase = await createClient() as any
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    if (authErr || !user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { unpaid_sale_ids, amount, method, reference, notes, shop_id } = await request.json()

    if (!unpaid_sale_ids?.length || !amount || !method || !shop_id) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }
    if (Number(amount) <= 0 || !isFinite(Number(amount))) {
      return NextResponse.json({ error: 'Le montant doit être supérieur à 0' }, { status: 400 })
    }

    // Verify caller has access to this shop
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const callerRole = memberRow?.role
    if (!callerRole || !['owner', 'manager', 'shop_manager', 'super_admin', 'cashier'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any

    // Fetch all unpaid sales sorted oldest first (FIFO)
    const { data: salesRaw, error: salesErr } = await admin
      .from('sales')
      .select('id, sale_number, total, amount_paid, balance, payment_status, sale_status, shop_id')
      .in('id', unpaid_sale_ids)
      .eq('shop_id', shop_id)
      .order('created_at', { ascending: true })

    if (salesErr) throw salesErr
    const sales = (salesRaw || []) as Array<{
      id: string; sale_number: string; total: number; amount_paid: number; balance: number
      payment_status: string; sale_status: string; shop_id: string
    }>

    let remaining = Number(amount)
    const appliedTo: { sale_id: string; sale_number: string; amount: number }[] = []

    // Pre-compute payment plan (no DB writes yet)
    for (const sale of sales) {
      if (remaining <= 0) break
      if (sale.sale_status === 'cancelled') continue
      const saleBalance = Number(sale.balance)
      if (saleBalance <= 0) continue
      const toApply = Math.min(remaining, saleBalance)
      appliedTo.push({ sale_id: sale.id, sale_number: sale.sale_number, amount: toApply })
      remaining -= toApply
    }

    // Batch INSERT — PostgreSQL treats a multi-row insert as a single atomic
    // statement: if any row fails (trigger exception, constraint), all rows
    // roll back. Avoids partial commits that were possible with the previous
    // loop of individual inserts.
    if (appliedTo.length > 0) {
      const { error: batchErr } = await admin.from('payments').insert(
        appliedTo.map(p => ({
          sale_id: p.sale_id,
          amount: p.amount,
          method,
          reference: reference || null,
          notes: notes || null,
          received_by: user.id,
          is_repayment: true,
        }))
      )
      if (batchErr) throw batchErr
    }

    return NextResponse.json({ success: true, applied: appliedTo, remaining })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
