import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { getLowStockAlerts, getExpiryAlerts } from '@/lib/alerts/stock-alerts'
import { buildOwnerAlertsEmail, countAlerts, type ShopAlerts } from '@/lib/email/owner-alerts-template'

// E-mail quotidien d'alertes de stock — UN par propriétaire (entreprise),
// toutes ses boutiques regroupées, envoyé seulement s'il y a au moins une
// alerte. Respecte les réglages de chaque boutique (notify_email_low_stock,
// notify_email_expiry). Remplace les e-mails par boutique des tâches
// low-stock-alert et expiry-alert (qui gardent les notifications push).
// ?dry=1 : calcule sans rien envoyer ni journaliser (&html=1 : contenu du 1er e-mail).

const resend = new Resend(process.env.RESEND_API_KEY)
const mask = (e: string | null) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1…$2') : null)

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'

  try {
    const admin = await createAdminClient() as any
    const today = new Date()
    const dateStr = today.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })

    const { data: shops, error } = await admin.from('shops')
      .select('id, name, entity_id, low_stock_threshold, expiry_alert_days, notify_email_low_stock, notify_email_expiry, created_at')
      .is('deleted_at', null).not('entity_id', 'is', null)
      .or('notify_email_low_stock.eq.true,notify_email_expiry.eq.true')
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)

    // Boutiques regroupées par entreprise (= un propriétaire)
    const byEntity: Record<string, any[]> = {}
    for (const s of shops || []) (byEntity[s.entity_id] ||= []).push(s)
    const { data: entities } = await admin.from('entities').select('id, owner_user_id').in('id', Object.keys(byEntity).length ? Object.keys(byEntity) : ['00000000-0000-0000-0000-000000000000'])

    const appUrl = appBaseUrl()
    const results: any[] = []
    let firstHtml: string | null = null

    for (const ent of entities || []) {
      if (!ent.owner_user_id) continue
      const shopAlerts: ShopAlerts[] = []
      for (const s of byEntity[ent.id]) {
        const low = s.notify_email_low_stock ? await getLowStockAlerts(admin, s) : { outOfStock: [], lowStock: [] }
        const exp = s.notify_email_expiry ? await getExpiryAlerts(admin, s, today) : { expired: [], expiringSoon: [] }
        shopAlerts.push({ name: s.name, outOfStock: low.outOfStock, lowStock: low.lowStock, expired: exp.expired, expiringSoon: exp.expiringSoon })
      }
      if (!shopAlerts.some(a => countAlerts(a) > 0)) continue

      const [{ data: owner }, { data: authUser }] = await Promise.all([
        admin.from('profiles').select('full_name, locale').eq('id', ent.owner_user_id).maybeSingle(),
        admin.auth.admin.getUserById(ent.owner_user_id),
      ])
      const email: string | null = authUser?.user?.email ?? null
      const mail = buildOwnerAlertsEmail({ ownerName: owner?.full_name ?? null, dateStr, shops: shopAlerts, appUrl })
      firstHtml ??= mail.html
      const r: any = { entity_id: ent.id, to: mask(email), shops: shopAlerts.filter(a => countAlerts(a) > 0).map(a => `${a.name} (${countAlerts(a)})`), total: mail.total, subject: mail.subject, status: 'dry' }

      if (!dry) {
        if (!email) r.status = 'no_email'
        else if (!process.env.RESEND_API_KEY) r.status = 'no_resend_key'
        else {
          const { error: sendError } = await resend.emails.send({ from: EMAIL_FROM, to: email, subject: mail.subject, html: mail.html })
          r.status = sendError ? `error: ${sendError.message}` : 'sent'
        }
      }
      results.push(r)
    }

    const summary = { dry, owners: results.length, sent: results.filter(r => r.status === 'sent').length, results }
    if (!dry) await logCronRun('owner-alerts', 'success', summary)
    return NextResponse.json(dry && params.get('html') === '1' ? { ...summary, html: firstHtml } : summary)
  } catch (err: any) {
    console.error('[cron/owner-alerts]', err)
    if (!dry) await logCronRun('owner-alerts', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
