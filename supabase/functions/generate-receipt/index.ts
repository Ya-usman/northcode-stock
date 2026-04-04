// Supabase Edge Function: generate-receipt
// Accepts sale_id, generates PDF receipt, uploads to Supabase Storage
// Returns public URL of the receipt PDF

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { sale_id } = await req.json()
    if (!sale_id) {
      return new Response(JSON.stringify({ error: 'sale_id required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch sale with all related data
    const { data: sale, error } = await supabase
      .from('sales')
      .select(`
        *,
        customers (name, phone),
        sale_items (product_name, quantity, unit_price, subtotal),
        shops (name, city, whatsapp, currency)
      `)
      .eq('id', sale_id)
      .single()

    if (error || !sale) {
      return new Response(JSON.stringify({ error: 'Sale not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get cashier name
    const { data: cashierProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', sale.cashier_id)
      .single()

    // Generate receipt HTML (will be used server-side)
    // Note: jsPDF doesn't run in Deno Edge Functions directly
    // Instead, we generate an HTML receipt and store it,
    // or use a third-party PDF service.
    // For production, use Puppeteer on a separate service.
    // Here we return receipt data for client-side PDF generation.

    const receiptData = {
      sale_number: sale.sale_number,
      date: new Date(sale.created_at).toLocaleString('en-NG'),
      shop: sale.shops,
      cashier: cashierProfile?.full_name || 'Unknown',
      customer: sale.customers?.name || 'Walk-in Customer',
      items: sale.sale_items,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      amount_paid: sale.amount_paid,
      balance: sale.balance,
      payment_method: sale.payment_method,
      payment_status: sale.payment_status,
    }

    // Check if PDF already exists in storage
    const storagePath = `receipts/${sale.shop_id}/${sale_id}.json`
    await supabase.storage.from('receipts').upload(
      storagePath,
      JSON.stringify(receiptData),
      { contentType: 'application/json', upsert: true }
    )

    const { data: { publicUrl } } = supabase.storage
      .from('receipts')
      .getPublicUrl(storagePath)

    return new Response(
      JSON.stringify({ success: true, receipt_data: receiptData, url: publicUrl }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
