// Supabase Edge Function: paystack-webhook
// Receives Paystack payment events, verifies HMAC SHA512,
// updates sale payment_status to 'paid'

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
}

async function verifyPaystackSignature(
  body: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(body)

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return computedSignature === signature
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const signature = req.headers.get('x-paystack-signature') || ''
    const body = await req.text()
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY')!

    // Verify signature
    const isValid = await verifyPaystackSignature(body, signature, paystackSecret)
    if (!isValid) {
      console.error('Invalid Paystack signature')
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const event = JSON.parse(body)
    console.log('Paystack event:', event.event, event.data?.reference)

    if (event.event !== 'charge.success') {
      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { reference, amount, metadata } = event.data
    const amountNaira = amount / 100 // Paystack amounts are in kobo

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find the sale by Paystack reference
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('id, total, amount_paid, shop_id, cashier_id')
      .eq('paystack_reference', reference)
      .single()

    if (saleError || !sale) {
      console.error('Sale not found for reference:', reference)
      return new Response(JSON.stringify({ error: 'Sale not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Record payment
    const { error: paymentError } = await supabase
      .from('payments')
      .insert({
        sale_id: sale.id,
        amount: amountNaira,
        method: 'paystack',
        reference: reference,
        received_by: sale.cashier_id,
      })

    if (paymentError) {
      console.error('Payment insert error:', paymentError)
      throw paymentError
    }

    // Update sale status (trigger handles amount_paid update)
    const newAmountPaid = Number(sale.amount_paid) + amountNaira
    const newStatus = newAmountPaid >= Number(sale.total) ? 'paid' : 'partial'

    const { error: updateError } = await supabase
      .from('sales')
      .update({
        payment_status: newStatus,
        amount_paid: newAmountPaid,
        paystack_reference: reference,
      })
      .eq('id', sale.id)

    if (updateError) throw updateError

    console.log(`Sale ${sale.id} updated to ${newStatus} via Paystack`)

    return new Response(
      JSON.stringify({ success: true, sale_id: sale.id, status: newStatus }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('paystack-webhook error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
