import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { buildMorningCheckEmail, ADMIN_TZ, type ServiceCheck } from '@/lib/email/morning-check-template'
import { collectMorningReport } from '@/lib/reports/morning-report'
import { logCronRun } from '@/lib/api/cron-log'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'

// Bilan du matin — état des services, des tâches automatiques, activité des
// clients et abonnements, envoyé chaque matin aux administrateurs (SUPER_ADMIN_EMAILS).
// ?dry=1 : calcule sans envoyer ni journaliser (&html=1 : contenu de l'e-mail).

const resend = new Resend(process.env.RESEND_API_KEY)

const ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim())
  .filter(Boolean)
const CONTACT_EMAIL = 'yahaya.dev@gmail.com'

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

// ── Tâche ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  // Vercel Cron transmet CRON_SECRET dans l'en-tête Authorization
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'

  // Envoi à 8 h, heure de Paris, toute l'année : Vercel déclenche à 06:00 ET
  // 07:00 UTC (vercel.json) ; seul le passage où il est 8 h à Paris envoie
  // (été UTC+2 → 06:00, hiver UTC+1 → 07:00). ?force=1 : envoi manuel.
  const parisHour = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: ADMIN_TZ }))
  if (!dry && params.get('force') !== '1' && parisHour !== 8) {
    return NextResponse.json({ ok: true, skipped: `il est ${parisHour} h à Paris : envoi à 8 h seulement` })
  }

  try {
    const admin = await createAdminClient() as any
    const appUrl = appBaseUrl()

    const [services, report] = await Promise.all([
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
      collectMorningReport(admin),
    ])

    const now = new Date()
    const date = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: ADMIN_TZ })
    const time = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: ADMIN_TZ }).replace(':', ' h ')
    const env = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production' ? `Test (${process.env.VERCEL_ENV})` : 'Production'
    const mail = buildMorningCheckEmail({ date, time, env, appUrl, contactEmail: CONTACT_EMAIL, services, ...report })

    const summary = {
      services: services.map(s => ({ name: s.name, status: s.status, ms: s.responseMs })),
      metrics: report.metrics,
      revenue_xaf: Math.round(report.revenue.last24),
      jobs_to_check: report.jobs.filter(j => j.status === 'error' || j.status === 'missing').map(j => j.label),
      subject: mail.subject,
    }
    if (dry) return NextResponse.json(params.get('html') === '1' ? { dry, ...summary, html: mail.html } : { dry, ...summary })

    const recipients = ADMIN_EMAILS.length ? ADMIN_EMAILS : [CONTACT_EMAIL]
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
