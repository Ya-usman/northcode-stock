// Supabase Edge Function: daily-report
// Triggered daily at 9pm WAT (8pm UTC) via pg_cron
// Sends daily summary to owner via WhatsApp + email

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

    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()
    const dateStr = today.toLocaleDateString('en-NG', { dateStyle: 'full' })

    const { data: shops } = await supabase
      .from('shops')
      .select('id, name, whatsapp, owner_id, notify_whatsapp_daily, notify_email_daily')

    for (const shop of shops ?? []) {
      // Today's sales stats
      const { data: sales } = await supabase
        .from('sales')
        .select('id, total, amount_paid, balance, payment_method, payment_status')
        .eq('shop_id', shop.id)
        .gte('created_at', startOfDay)
        .lt('created_at', endOfDay)

      const salesCount = sales?.length ?? 0
      const totalRevenue = sales?.reduce((sum, s) => sum + Number(s.total), 0) ?? 0
      const totalCollected = sales?.reduce((sum, s) => sum + Number(s.amount_paid), 0) ?? 0
      const outstandingToday = sales?.reduce((sum, s) => sum + Number(s.balance), 0) ?? 0

      // Payment method breakdown
      const byMethod: Record<string, number> = {}
      sales?.forEach(s => {
        byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + Number(s.total)
      })

      // Top product today
      const { data: topItems } = await supabase
        .from('sale_items')
        .select('product_name, quantity, subtotal, sale_id')
        .in('sale_id', sales?.map(s => s.id) ?? [])

      const productTotals: Record<string, { qty: number; revenue: number }> = {}
      topItems?.forEach(item => {
        if (!productTotals[item.product_name]) {
          productTotals[item.product_name] = { qty: 0, revenue: 0 }
        }
        productTotals[item.product_name].qty += item.quantity
        productTotals[item.product_name].revenue += Number(item.subtotal)
      })
      const topProduct = Object.entries(productTotals)
        .sort((a, b) => b[1].revenue - a[1].revenue)[0]

      // Total outstanding debt
      const { data: debtData } = await supabase
        .from('customers')
        .select('total_debt')
        .eq('shop_id', shop.id)
        .gt('total_debt', 0)

      const totalDebt = debtData?.reduce((sum, c) => sum + Number(c.total_debt), 0) ?? 0

      // Low stock count
      const { count: lowStockCount } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .lte('quantity', 10)

      // Build message
      const formatNaira = (n: number) => `₦${n.toLocaleString('en-NG')}`
      const methodLines = Object.entries(byMethod)
        .map(([m, v]) => `  • ${m.charAt(0).toUpperCase() + m.slice(1)}: ${formatNaira(v)}`)
        .join('\n')

      const message = [
        `📊 *Daily Report — ${shop.name}*`,
        `📅 ${dateStr}`,
        ``,
        `💰 *Revenue Summary:*`,
        `• Sales: ${salesCount} transaction(s)`,
        `• Total: ${formatNaira(totalRevenue)}`,
        `• Collected: ${formatNaira(totalCollected)}`,
        `• Pending: ${formatNaira(outstandingToday)}`,
        ``,
        `💳 *By Payment Method:*`,
        methodLines || '  • No sales today',
        ``,
        topProduct ? `🏆 *Best Seller:* ${topProduct[0]}\n   ${topProduct[1].qty} units · ${formatNaira(topProduct[1].revenue)}` : '',
        ``,
        `📦 *Stock Alerts:* ${lowStockCount ?? 0} item(s) low`,
        `💳 *Total Outstanding Debt:* ${formatNaira(totalDebt)}`,
        ``,
        `_StockShop Manager_`,
      ].filter(Boolean).join('\n')

      // WhatsApp
      if (shop.notify_whatsapp_daily && shop.whatsapp) {
        const waNumber = shop.whatsapp.replace(/\D/g, '')
        const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`
        console.log(`Daily report WhatsApp for ${shop.name}: ${waUrl}`)
      }

      // Email
      if (shop.notify_email_daily && shop.owner_id) {
        const { data: userData } = await supabase.auth.admin.getUserById(shop.owner_id)
        if (userData?.user?.email) {
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
                to: userData.user.email,
                subject: `📊 Daily Report — ${shop.name} — ${salesCount} sales · ${formatNaira(totalRevenue)}`,
                html: buildDailyEmailHtml(shop.name, dateStr, {
                  salesCount, totalRevenue, totalCollected, outstandingToday,
                  byMethod, topProduct: topProduct ? { name: topProduct[0], ...topProduct[1] } : null,
                  lowStockCount: lowStockCount ?? 0, totalDebt,
                }),
              }),
            })
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function buildDailyEmailHtml(shopName: string, date: string, data: any): string {
  const fmt = (n: number) => `₦${n.toLocaleString('en-NG')}`
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px}
  .header{background:#0A2F6E;color:white;padding:20px;border-radius:8px 8px 0 0}
  .section{background:white;border:1px solid #e5e7eb;padding:16px;margin:8px 0;border-radius:6px}
  .stat{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6}
  .highlight{font-size:24px;font-weight:bold;color:#0A2F6E}
  .footer{background:#0A2F6E;color:#93c5fd;padding:12px 20px;font-size:12px;border-radius:0 0 8px 8px}
</style></head>
<body>
<div class="header">
  <h2 style="margin:0">📊 Daily Report</h2>
  <p style="margin:4px 0 0;opacity:0.8">${shopName} · ${date}</p>
</div>
<div class="section">
  <h3 style="margin-top:0">💰 Revenue</h3>
  <div class="stat"><span>Total Sales</span><span class="highlight">${fmt(data.totalRevenue)}</span></div>
  <div class="stat"><span>Transactions</span><span>${data.salesCount}</span></div>
  <div class="stat"><span>Collected</span><span style="color:#16A34A">${fmt(data.totalCollected)}</span></div>
  <div class="stat"><span>Outstanding</span><span style="color:#DC2626">${fmt(data.outstandingToday)}</span></div>
</div>
<div class="section">
  <h3 style="margin-top:0">💳 Payment Methods</h3>
  ${Object.entries(data.byMethod).map(([m, v]: any) =>
    `<div class="stat"><span>${m.charAt(0).toUpperCase() + m.slice(1)}</span><span>${fmt(v)}</span></div>`
  ).join('') || '<p style="color:#9ca3af">No sales today</p>'}
</div>
${data.topProduct ? `
<div class="section">
  <h3 style="margin-top:0">🏆 Best Seller</h3>
  <p><strong>${data.topProduct.name}</strong></p>
  <p>${data.topProduct.qty} units · ${fmt(data.topProduct.revenue)}</p>
</div>` : ''}
<div class="section">
  <h3 style="margin-top:0">📊 Overview</h3>
  <div class="stat"><span>Low Stock Items</span><span style="color:#D97706">${data.lowStockCount}</span></div>
  <div class="stat"><span>Total Outstanding Debt</span><span style="color:#DC2626">${fmt(data.totalDebt)}</span></div>
</div>
<div class="footer">StockShop Manager · Automated daily report</div>
</body></html>`
}
