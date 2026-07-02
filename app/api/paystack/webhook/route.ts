import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.text()
    const signature = request.headers.get('x-paystack-signature') || ''
    const secret = process.env.PAYSTACK_SECRET_KEY!

    // Verify HMAC SHA512 signature — this is the only auth mechanism for webhooks
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

    // Webhooks carry no session cookie — must use admin client to bypass RLS.
    // The HMAC check above already validates the request origin.
    const admin = await createAdminClient() as any

    // Find sale by Paystack reference
    const { data: sale } = await admin
      .from('sales')
      .select('id, total, amount_paid, cashier_id, shop_id')
      .eq('paystack_reference', reference)
      .single()

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Record payment and surface any DB error — a silent failure would leave
    // the sale in pending status even though Paystack confirms the charge.
    const { error: payErr } = await admin.from('payments').insert({
      sale_id: sale.id,
      amount: amountNaira,
      method: 'paystack',
      reference,
      received_by: sale.cashier_id,
    })
    if (payErr) {
      console.error('[paystack-webhook] Failed to insert payment:', payErr.message)
      return NextResponse.json({ error: payErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
