// Supabase Edge Function: low-stock-alert
// Triggered daily at 8am WAT (7am UTC) via pg_cron
// Sends WhatsApp deep link + Resend email for low stock items

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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Get all active shops
    const { data: shops, error: shopsError } = await supabase
      .from('shops')
      .select('id, name, whatsapp, owner_id, low_stock_threshold, notify_whatsapp_low_stock, notify_email_low_stock')

    if (shopsError) throw shopsError

    for (const shop of shops ?? []) {
      // Get low-stock products
      const { data: products } = await supabase
        .from('products')
        .select('id, name, name_hausa, quantity, low_stock_threshold, unit')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .lte('quantity', shop.low_stock_threshold)
        .order('quantity', { ascending: true })

      if (!products || products.length === 0) continue

      const outOfStock = products.filter(p => p.quantity === 0)
      const lowStock = products.filter(p => p.quantity > 0)

      // Build alert message
      const lines: string[] = [
        `🔴 *NorthCode Stock Alert*`,
        `Shop: ${shop.name}`,
        `Date: ${new Date().toLocaleDateString('en-NG', { dateStyle: 'full' })}`,
        ``,
        `*${products.length} product(s) need attention:*`,
      ]

      if (outOfStock.length > 0) {
        lines.push(``, `❌ *OUT OF STOCK (${outOfStock.length}):*`)
        outOfStock.forEach(p => {
          lines.push(`• ${p.name} — 0 ${p.unit}s remaining`)
        })
      }

      if (lowStock.length > 0) {
        lines.push(``, `⚠️ *LOW STOCK (${lowStock.length}):*`)
        lowStock.forEach(p => {
          const threshold = p.low_stock_threshold || shop.low_stock_threshold
          lines.push(`• ${p.name} — ${p.quantity} left (min: ${threshold})`)
        })
      }

      lines.push(``, `Please restock soon.`, `_NorthCode Stock Manager_`)

      const message = lines.join('\n')

      // Send WhatsApp deep link (owner must have WhatsApp)
      if (shop.notify_whatsapp_low_stock && shop.whatsapp) {
        const waNumber = shop.whatsapp.replace(/\D/g, '')
        const waMessage = encodeURIComponent(message)
        const waUrl = `https://wa.me/${waNumber}?text=${waMessage}`
        console.log(`WhatsApp alert URL for ${shop.name}: ${waUrl}`)
        // In production with Twilio WhatsApp API:
        // await sendTwilioWhatsApp(waNumber, message)
      }

      // Send email via Resend
      if (shop.notify_email_low_stock && shop.owner_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', shop.owner_id)
          .single()

        const { data: userEmail } = await supabase.auth.admin.getUserById(shop.owner_id)

        if (userEmail?.user?.email) {
          const resendKey = Deno.env.get('RESEND_API_KEY')
          if (resendKey) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: Deno.env.get('RESEND_FROM_EMAIL') || 'alerts@northcode-stock.ng',
                to: userEmail.user.email,
                subject: `🔴 Low Stock Alert — ${shop.name} (${products.length} items)`,
                html: buildEmailHtml(shop.name, outOfStock, lowStock, shop.low_stock_threshold),
              }),
            })
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Low stock alerts sent' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('low-stock-alert error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildEmailHtml(shopName: string, outOfStock: any[], lowStock: any[], threshold: number): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: #0A2F6E; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
  .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
  .product-row { background: white; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin: 6px 0; }
  .out { border-left: 4px solid #DC2626; }
  .low { border-left: 4px solid #D97706; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
  .badge-out { background: #FEE2E2; color: #DC2626; }
  .badge-low { background: #FEF3C7; color: #D97706; }
  .footer { background: #0A2F6E; color: #93c5fd; padding: 12px 20px; font-size: 12px; border-radius: 0 0 8px 8px; }
</style></head>
<body>
<div class="header">
  <h2 style="margin:0">🔴 Stock Alert — ${shopName}</h2>
  <p style="margin:4px 0 0; opacity:0.8">${new Date().toLocaleDateString('en-NG', { dateStyle: 'full' })}</p>
</div>
<div class="content">
  <p><strong>${outOfStock.length + lowStock.length} product(s) need restocking:</strong></p>
  ${outOfStock.length > 0 ? `
    <h3 style="color:#DC2626">❌ Out of Stock (${outOfStock.length})</h3>
    ${outOfStock.map(p => `
      <div class="product-row out">
        <strong>${p.name}</strong> ${p.name_hausa ? `(${p.name_hausa})` : ''}
        <span class="badge badge-out">0 left</span>
      </div>`).join('')}` : ''}
  ${lowStock.length > 0 ? `
    <h3 style="color:#D97706">⚠️ Low Stock (${lowStock.length})</h3>
    ${lowStock.map(p => `
      <div class="product-row low">
        <strong>${p.name}</strong> ${p.name_hausa ? `(${p.name_hausa})` : ''}
        <span class="badge badge-low">${p.quantity} left (min: ${p.low_stock_threshold || threshold})</span>
      </div>`).join('')}` : ''}
  <p style="margin-top:20px">Please log in to <strong>NorthCode Stock Manager</strong> to restock these items.</p>
</div>
<div class="footer">NorthCode Stock Manager · Automated alert</div>
</body>
</html>`
}
