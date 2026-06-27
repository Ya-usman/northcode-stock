import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { buildEveningSummaryHtml } from '@/lib/email/evening-summary-template'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAIL = 'yahaya.dev@gmail.com'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient() as any

    const since = new Date()
    since.setHours(0, 0, 0, 0)
    const sinceIso = since.toISOString()

    // Run all queries in parallel
    const [
      { data: salesData },
      { data: expensesData },
      { data: newCustomers },
      { count: unpaidCount },
      { data: saleItems },
      { data: lowStockData },
    ] = await Promise.all([
      // All today's active sales
      admin.from('sales')
        .select('shop_id, total')
        .gte('created_at', sinceIso)
        .eq('sale_status', 'active'),

      // Today's expenses
      admin.from('expenses')
        .select('amount')
        .gte('date', sinceIso.split('T')[0])
        .eq('is_recurring', false),

      // New customers today
      admin.from('customers')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso),

      // Unpaid sales today
      admin.from('sales')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', sinceIso)
        .eq('payment_status', 'unpaid')
        .eq('sale_status', 'active'),

      // Sale items to find top products
      admin.from('sale_items')
        .select('product_id, quantity, products(name, shop_id, shops(name))')
        .gte('created_at', sinceIso),

      // Products at or below threshold grouped by shop
      admin.from('shops')
        .select('id, name, low_stock_threshold, products(id, name, quantity, low_stock_threshold)')
        .eq('products.is_active', true),
    ])

    const sales = salesData || []
    const totalRevenue = sales.reduce((s: number, r: any) => s + Number(r.total || 0), 0)
    const totalExpenses = (expensesData || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
    const activeShops = new Set(sales.map((s: any) => s.shop_id)).size

    // Aggregate top products
    const productQty: Record<string, { name: string; shopName: string; qty: number }> = {}
    for (const item of (saleItems || [])) {
      const id = item.product_id
      if (!id) continue
      const name = item.products?.name ?? 'Inconnu'
      const shopName = item.products?.shops?.name ?? ''
      if (!productQty[id]) productQty[id] = { name, shopName, qty: 0 }
      productQty[id].qty += Number(item.quantity || 0)
    }
    const topProducts = Object.values(productQty)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // Low stock per shop
    const lowStockShops: { shopName: string; count: number }[] = []
    for (const shop of (lowStockData || [])) {
      const threshold = shop.low_stock_threshold ?? 10
      const count = (shop.products || []).filter((p: any) => {
        const t = p.low_stock_threshold ?? threshold
        return p.quantity <= t
      }).length
      if (count > 0) lowStockShops.push({ shopName: shop.name, count })
    }

    const date = format(new Date(), "EEEE d MMMM yyyy", { locale: fr })

    const html = buildEveningSummaryHtml({
      date,
      totalSales: sales.length,
      totalRevenue,
      totalExpenses,
      netRevenue: totalRevenue - totalExpenses,
      newCustomers: newCustomers?.count ?? 0,
      unpaidSales: unpaidCount ?? 0,
      activeShops,
      lowStockShops,
      topProducts,
    })

    const hasLowStock = lowStockShops.length > 0
    const subject = hasLowStock
      ? `⚠️ Bilan du ${format(new Date(), 'dd/MM')} — ${lowStockShops.length} alerte(s) stock | StockShop`
      : `🌙 Bilan du ${format(new Date(), 'dd/MM')} — ${sales.length} vente(s) · ${new Intl.NumberFormat('fr-FR').format(Math.round(totalRevenue))} F | StockShop`

    const { error: sendError } = await resend.emails.send({
      from: 'StockShop <onboarding@resend.dev>',
      to: ADMIN_EMAIL,
      subject,
      html,
    })
    if (sendError) throw new Error(sendError.message)

    return NextResponse.json({
      ok: true,
      totalSales: sales.length,
      totalRevenue,
      totalExpenses,
      activeShops,
      lowStockShops: lowStockShops.length,
    })
  } catch (err: any) {
    console.error('[cron/evening-summary]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
