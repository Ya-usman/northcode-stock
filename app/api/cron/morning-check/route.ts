import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { buildMorningCheckHtml, type ServiceCheck, type ServiceStatus } from '@/lib/email/morning-check-template'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

// ── Service health checks ────────────────────────────────────────────────────

async function checkService(name: string, fn: () => Promise<void>): Promise<ServiceCheck> {
  const start = Date.now()
  try {
    await fn()
    return { name, status: 'ok', detail: 'No issues reported.', responseMs: Date.now() - start }
  } catch (err: any) {
    return { name, status: 'incident', detail: err?.message || 'Error', responseMs: Date.now() - start }
  }
}

async function checkUrl(url: string, timeoutMs = 6000): Promise<void> {
  const res = await fetch(url, {
    method: 'HEAD',
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ── Metrics from Supabase ───────────────────────────────────────────────────

async function getMetrics(admin: Awaited<ReturnType<typeof createAdminClient>>) {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const in7days  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const today    = new Date().toISOString()

  const [
    { count: newShops },
    { count: totalShops },
    { count: totalUsers },
    { data: recentSales },
    { count: failedPayments },
    { count: expiringPlans },
  ] = await Promise.all([
    admin.from('shops').select('id', { count: 'exact', head: true }).gte('created_at', since24h),
    admin.from('shops').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('sales')
      .select('shop_id, total')
      .gte('created_at', since24h)
      .eq('sale_status', 'active'),
    admin.from('sales').select('id', { count: 'exact', head: true })
      .gte('created_at', since24h)
      .eq('payment_status', 'unpaid')
      .eq('payment_method', 'cash'),
    admin.from('shops').select('id', { count: 'exact', head: true })
      .not('plan_expires_at', 'is', null)
      .lte('plan_expires_at', in7days)
      .gte('plan_expires_at', today),
  ])

  const sales = recentSales || []
  const activeSaleShops = new Set(sales.map((s: any) => s.shop_id)).size
  const totalRevenue = sales.reduce((sum: number, s: any) => sum + Number(s.total), 0)

  return {
    newShops:       newShops       ?? 0,
    totalShops:     totalShops     ?? 0,
    totalUsers:     totalUsers     ?? 0,
    activeSaleShops,
    totalSales:     sales.length,
    totalRevenue,
    failedPayments: failedPayments ?? 0,
    expiringPlans:  expiringPlans  ?? 0,
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Vercel Cron passes the CRON_SECRET via Authorization header
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient()
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://northcode-stock.vercel.app'
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''

    // Run all service checks + metrics in parallel
    const [services, metrics] = await Promise.all([
      Promise.all([
        checkService('API / Serveur', () => checkUrl(`${siteUrl}/api/health`)),
        checkService('Base de données (Supabase)', async () => {
          const { error } = await admin.from('shops').select('id').limit(1)
          if (error) throw new Error(error.message)
        }),
        checkService('Authentification (Supabase Auth)', async () => {
          const { error } = await admin.auth.admin.listUsers({ perPage: 1 })
          if (error) throw new Error(error.message)
        }),
        checkService('Supabase Storage', async () => {
          const { error } = await admin.storage.listBuckets()
          if (error) throw new Error(error.message)
        }),
        ...(process.env.PAYSTACK_SECRET_KEY ? [
          checkService('Paystack', () => checkUrl('https://paystack.com')),
        ] : []),
        ...(process.env.FLUTTERWAVE_SECRET_KEY ? [
          checkService('Flutterwave', () => checkUrl('https://flutterwave.com')),
        ] : []),
        ...(process.env.NOTCHPAY_PUBLIC_KEY ? [
          checkService('NotchPay', () => checkUrl('https://notchpay.co')),
        ] : []),
      ]),
      getMetrics(admin),
    ])

    const hasIncident   = services.some(s => s.status === 'incident')
    const hasDisruption = services.some(s => s.status === 'disruption')

    const date = format(new Date(), "EEEE d MMMM yyyy", { locale: fr })

    const html = buildMorningCheckHtml({
      date,
      services,
      metrics,
      hasIncident,
      hasDisruption,
    })

    const overallLabel = hasIncident
      ? '⛈️ INCIDENT — StockShop Daily Check'
      : hasDisruption
        ? '🌦️ PERTURBATION — StockShop Daily Check'
        : '☀️ All OK — StockShop Daily Check'

    // Until a custom domain is verified in Resend, onboarding@resend.dev
    // can only send to the Resend account owner email.
    const toAddresses = process.env.RESEND_DOMAIN_VERIFIED === 'true'
      ? ADMIN_EMAILS
      : [ADMIN_EMAILS[0]]

    const { error: sendError } = await resend.emails.send({
      from: 'StockShop <onboarding@resend.dev>',
      to: toAddresses,
      subject: `${overallLabel} | ${format(new Date(), 'dd/MM/yyyy')}`,
      html,
    })
    if (sendError) throw new Error(sendError.message)

    return NextResponse.json({
      ok: true,
      services: services.map(s => ({ name: s.name, status: s.status })),
      metrics,
    })
  } catch (err: any) {
    console.error('[morning-check]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
