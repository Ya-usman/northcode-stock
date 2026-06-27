import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient() as any
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const dateStr = format(today, "EEEE d MMMM yyyy", { locale: fr })

    // All shops that have daily email enabled
    const { data: shops } = await admin
      .from('shops')
      .select('id, name, owner_id, currency, low_stock_threshold, notify_email_daily')
      .eq('notify_email_daily', true)

    if (!shops?.length) return NextResponse.json({ ok: true, sent: 0 })

    const results: Record<string, string> = {}

    for (const shop of shops) {
      // Today's sales
      const { data: sales } = await admin
        .from('sales')
        .select('id, total, amount_paid, balance, payment_method, payment_status')
        .eq('shop_id', shop.id)
        .gte('created_at', startOfDay)
        .eq('sale_status', 'active')

      const salesCount = sales?.length ?? 0
      const totalRevenue = (sales ?? []).reduce((s: number, r: any) => s + Number(r.total), 0)
      const totalCollected = (sales ?? []).reduce((s: number, r: any) => s + Number(r.amount_paid), 0)
      const outstanding = (sales ?? []).reduce((s: number, r: any) => s + Number(r.balance), 0)

      // Payment method breakdown
      const byMethod: Record<string, number> = {}
      ;(sales ?? []).forEach((s: any) => {
        byMethod[s.payment_method] = (byMethod[s.payment_method] || 0) + Number(s.total)
      })

      // Top products today
      const saleIds = (sales ?? []).map((s: any) => s.id)
      const { data: items } = saleIds.length
        ? await admin.from('sale_items').select('product_name, quantity, subtotal').in('sale_id', saleIds)
        : { data: [] }

      const productMap: Record<string, { qty: number; revenue: number }> = {}
      ;(items ?? []).forEach((item: any) => {
        if (!productMap[item.product_name]) productMap[item.product_name] = { qty: 0, revenue: 0 }
        productMap[item.product_name].qty += Number(item.quantity)
        productMap[item.product_name].revenue += Number(item.subtotal)
      })
      const topProduct = Object.entries(productMap).sort((a, b) => b[1].revenue - a[1].revenue)[0]

      // Total customer debt
      const { data: debts } = await admin
        .from('customers').select('total_debt').eq('shop_id', shop.id).gt('total_debt', 0)
      const totalDebt = (debts ?? []).reduce((s: number, c: any) => s + Number(c.total_debt), 0)

      // Low stock count
      const threshold = shop.low_stock_threshold ?? 10
      const { count: lowStockCount } = await admin
        .from('products').select('id', { count: 'exact', head: true })
        .eq('shop_id', shop.id).eq('is_active', true).lte('quantity', threshold)

      // Today's expenses
      const { data: expenses } = await admin
        .from('expenses').select('amount')
        .eq('shop_id', shop.id).gte('date', startOfDay.split('T')[0]).eq('is_recurring', false)
      const totalExpenses = (expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0)

      // Get owner email
      if (!shop.owner_id) { results[shop.name] = 'no_owner_id'; continue }
      const { data: ownerData } = await admin.auth.admin.getUserById(shop.owner_id)
      const ownerEmail = ownerData?.user?.email
      if (!ownerEmail) { results[shop.name] = 'no_email'; continue }

      const sym = shop.currency || 'F CFA'
      const fmt2 = (n: number) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} ${sym}`

      const { error: sendError } = await resend.emails.send({
        from: 'StockShop <onboarding@resend.dev>',
        to: ownerEmail,
        subject: `🌙 Bilan du ${format(today, 'dd/MM')} — ${shop.name} · ${salesCount} vente(s) · ${fmt2(totalRevenue)}`,
        html: buildDailyEmailHtml(shop.name, dateStr, {
          salesCount, totalRevenue, totalCollected, outstanding,
          byMethod, topProduct: topProduct ? { name: topProduct[0], ...topProduct[1] } : null,
          lowStockCount: lowStockCount ?? 0, totalDebt, totalExpenses, currency: sym,
        }),
      })

      results[shop.name] = sendError ? `error: ${sendError.message}` : 'sent'
    }

    return NextResponse.json({ ok: true, shops: shops.length, results })
  } catch (err: any) {
    console.error('[cron/evening-summary]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildDailyEmailHtml(shopName: string, date: string, data: any): string {
  const sym = data.currency || 'F CFA'
  const fmt = (n: number) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} ${sym}`
  const net = data.totalRevenue - data.totalExpenses

  const methodRows = Object.entries(data.byMethod ?? {}).map(([m, v]: any) =>
    `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6;">
      <span style="color:#374151;text-transform:capitalize;">${m}</span>
      <span style="font-weight:600;color:#073e8a;">${fmt(v)}</span>
    </div>`
  ).join('') || '<p style="color:#9ca3af;font-size:13px;">Aucune vente aujourd\'hui</p>'

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

  <tr><td align="center" style="padding-bottom:20px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="background:#073e8a;border-radius:12px;padding:10px 22px;">
        <span style="color:#fff;font-size:17px;font-weight:700;">StockShop</span>
        <span style="color:#D4AF37;font-size:17px;font-weight:700;">.</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(7,62,138,0.08);overflow:hidden;">

    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:linear-gradient(135deg,#073e8a 0%,#0d52b8 100%);padding:28px 32px 24px;">
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">Résumé du jour</p>
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">🌙 ${shopName}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${date}</p>
    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 32px;">

      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
        <tr>
          <td style="width:50%;padding-right:6px;">
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#16a34a;">${fmt(data.totalRevenue)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:3px;text-transform:uppercase;">Recettes</div>
            </div>
          </td>
          <td style="width:50%;padding-left:6px;">
            <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#073e8a;">${data.salesCount}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:3px;text-transform:uppercase;">Ventes</div>
            </div>
          </td>
        </tr>
        <tr><td colspan="2" style="height:8px;"></td></tr>
        <tr>
          <td style="width:50%;padding-right:6px;">
            <div style="background:#fef9f0;border:1px solid #fde68a;border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:#d97706;">${fmt(data.totalExpenses)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:3px;text-transform:uppercase;">Dépenses</div>
            </div>
          </td>
          <td style="width:50%;padding-left:6px;">
            <div style="background:${net >= 0 ? '#f0fdf4' : '#fef2f2'};border:1px solid ${net >= 0 ? '#bbf7d0' : '#fecaca'};border-radius:10px;padding:14px;text-align:center;">
              <div style="font-size:20px;font-weight:700;color:${net >= 0 ? '#16a34a' : '#dc2626'};">${net >= 0 ? '+' : ''}${fmt(net)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:3px;text-transform:uppercase;">Net</div>
            </div>
          </td>
        </tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:10px;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">💰 Encaissé</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:#16a34a;text-align:right;border-bottom:1px solid #f3f4f6;">${fmt(data.totalCollected)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">⏳ En attente</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${data.outstanding > 0 ? '#d97706' : '#6b7280'};text-align:right;border-bottom:1px solid #f3f4f6;">${fmt(data.outstanding)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">💳 Dettes clients</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${data.totalDebt > 0 ? '#dc2626' : '#6b7280'};text-align:right;border-bottom:1px solid #f3f4f6;">${fmt(data.totalDebt)}</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:#374151;">⚠️ Produits stock bas</td>
          <td style="padding:10px 16px;font-size:13px;font-weight:600;color:${data.lowStockCount > 0 ? '#d97706' : '#16a34a'};text-align:right;">${data.lowStockCount > 0 ? data.lowStockCount + ' produit(s)' : 'Aucun ✅'}</td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">💳 Par mode de paiement</p>
      <div style="background:#f9fafb;border-radius:10px;padding:12px 16px;margin-bottom:20px;">${methodRows}</div>

      ${data.topProduct ? `
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:0.5px;">🏆 Meilleure vente</p>
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px 16px;">
        <div style="font-weight:600;color:#073e8a;font-size:14px;">${data.topProduct.name}</div>
        <div style="color:#6b7280;font-size:13px;margin-top:4px;">${data.topProduct.qty} unité(s) · ${fmt(data.topProduct.revenue)}</div>
      </div>` : ''}

    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#f9fafb;border-top:3px solid #D4AF37;padding:14px 32px;">
      <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">StockShop · Résumé automatique de fin de journée</p>
    </td></tr></table>

  </td></tr>
</table>
</td></tr></table>
</body></html>`
}
