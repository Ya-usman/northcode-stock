import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-paystack-signature') || ''
    const secret = process.env.PAYSTACK_SECRET_KEY!

    // Verify HMAC SHA512 signature
    const hash = createHmac('sha512', secret).update(body).digest('hex')
    if (hash !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    const event = JSON.parse(body)
    if (event.event !== 'charge.success') {
      return NextResponse.json({ received: true })
    }

    const { reference, amount } = event.data
    const amountNaira = amount / 100

    const supabase = await createClient() as any

    // Find sale by Paystack reference
    const { data: sale } = await supabase
      .from('sales')
      .select('id, total, amount_paid, cashier_id, shop_id')
      .eq('paystack_reference', reference)
      .single()

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Record payment
    await supabase.from('payments').insert({
      sale_id: sale.id,
      amount: amountNaira,
      method: 'paystack',
      reference,
      received_by: sale.cashier_id,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
