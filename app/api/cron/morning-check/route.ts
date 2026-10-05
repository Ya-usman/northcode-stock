import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { buildMorningCheckEmail, type ServiceCheck, type ExpiringPlan } from '@/lib/email/morning-check-template'
import { logCronRun } from '@/lib/api/cron-log'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { getPlan } from '@/lib/saas/plans'

// Bilan du matin — état des services et activité de la plateforme, envoyé
// chaque matin aux administrateurs (SUPER_ADMIN_EMAILS).
// ?dry=1 : calcule sans envoyer ni journaliser (&html=1 : contenu de l'e-mail).

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)

// ── Vérification des services ───────────────────────────────────────────────

async function checkService(name: string, fn: () => Promise<void>): Promise<ServiceCheck> {
  const start = Date.now()
  try {
    await fn()
    return { name, status: 'ok', detail: '', responseMs: Date.now() - start }
  } catch (err: any) {
    return { name, status: 'incident', detail: err?.message || 'Erreur', responseMs: Date.now() - start }
  }
}

async function checkUrl(url: string, timeoutMs = 6000): Promise<void> {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ── Indicateurs ─────────────────────────────────────────────────────────────

async function getMetrics(admin: any) {
  const now = Date.now()
  const since24h = new Date(now - 24 * 3600_000).toISOString()
  const in7days = new Date(now + 7 * 86_400_000).toISOString()

  const [
    { count: newShops },
    { count: totalShops },
    { count: totalUsers },
    { data: recentSales },
    { count: unpaidSales },
    { data: expiring },
  ] = await Promise.all([
    admin.from('shops').select('id', { count: 'exact', head: true }).gte('created_at', since24h).is('deleted_at', null),
    admin.from('shops').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('sales').select('shop_id').gte('created_at', since24h).eq('sale_status', 'active'),
    admin.from('sales').select('id', { count: 'exact', head: true })
      .gte('created_at', since24h).eq('payment_status', 'unpaid').eq('payment_method', 'cash'),
    // Abonnement porté par l'ENTREPRISE (migration 153) : une ligne par entreprise
    admin.from('entities').select('name, plan, plan_expires_at, is_internal')
      .not('plan_expires_at', 'is', null).lte('plan_expires_at', in7days).gte('plan_expires_at', new Date(now).toISOString())
      .order('plan_expires_at', { ascending: true }),
  ])

  const sales = recentSales || []
  const expiringPlans: ExpiringPlan[] = (expiring || [])
    .filter((e: any) => !e.is_internal)
    .map((e: any) => ({ name: e.name || 'Entreprise sans nom', plan: getPlan(e.plan).name, expires_at: e.plan_expires_at }))

  return {
    metrics: {
      newShops: newShops ?? 0,
      totalShops: totalShops ?? 0,
      totalUsers: totalUsers ?? 0,
      activeSaleShops: new Set(sales.map((s: any) => s.shop_id)).size,
      totalSales: sales.length,
      unpaidSales: unpaidSales ?? 0,
    },
    expiringPlans,
  }
}

// ── Tâche ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Vercel Cron transmet CRON_SECRET dans l'en-tête Authorization
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'

  try {
    const admin = await createAdminClient() as any
    const appUrl = appBaseUrl()

    const [services, { metrics, expiringPlans }] = await Promise.all([
      Promise.all([
        checkService('Site et API', () => checkUrl(`${appUrl}/api/health`)),
        checkService('Base de données', async () => {
          const { error } = await admin.from('shops').select('id').limit(1)
          if (error) throw new Error(error.message)
        }),
        checkService('Connexion des utilisateurs', async () => {
          const { error } = await admin.auth.admin.listUsers({ perPage: 1 })
          if (error) throw new Error(error.message)
        }),
        checkService('Stockage des fichiers', async () => {
          const { error } = await admin.storage.listBuckets()
          if (error) throw new Error(error.message)
        }),
      ]),
      getMetrics(admin),
    ])

    const now = new Date()
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }).replace(':', ' h ')
    const mail = buildMorningCheckEmail({ date, time, services, metrics, expiringPlans, appUrl })

    const summary = { services: services.map(s => ({ name: s.name, status: s.status, ms: s.responseMs })), metrics, expiring: expiringPlans.length, subject: mail.subject }
    if (dry) return NextResponse.json(params.get('html') === '1' ? { dry, ...summary, html: mail.html } : { dry, ...summary })

    const recipients = ADMIN_EMAILS.length ? ADMIN_EMAILS : ['yahaya.dev@gmail.com']
    const { error: sendError } = await resend.emails.send({ from: EMAIL_FROM, to: recipients, subject: mail.subject, html: mail.html })
    if (sendError) throw new Error(sendError.message)

    await logCronRun('morning-check', 'success', summary)
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    console.error('[morning-check]', err)
    if (!dry) await logCronRun('morning-check', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
