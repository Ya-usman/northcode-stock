import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { collectShopDay, type ShopDay } from '@/lib/reports/evening-report'
import { buildEveningSummaryEmail, hasActivity } from '@/lib/email/evening-summary-template'
import { timeZoneFor } from '@/lib/reports/day-window'
import { emailI18n } from '@/lib/email/i18n'

// Résumé de la journée — UN e-mail par propriétaire (entreprise), une section
// par boutique ayant l'option « Résumé quotidien » (shops.notify_email_daily).
// Journée = journée locale du pays de chaque boutique.
//
// EN PAUSE tant que EVENING_SUMMARY_EMAILS ne vaut pas « on » (décision du
// 5 oct. 2026 : à annoncer aux clients avant activation). Rien n'est envoyé.
// ?dry=1 : calcule sans envoyer ni journaliser, même en pause
// (&html=1 : contenu du 1er e-mail ; &entity=<id> : une seule entreprise).

const resend = new Resend(process.env.RESEND_API_KEY)
const mask = (e: string | null) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1…$2') : null)

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'

  if (!dry && process.env.EVENING_SUMMARY_EMAILS !== 'on') {
    await logCronRun('evening-summary', 'success', { paused: true })
    return NextResponse.json({ ok: true, paused: true })
  }

  try {
    const admin = await createAdminClient() as any
    const appUrl = appBaseUrl()
    const now = new Date()

    let q = admin.from('shops')
      .select('id, name, currency, country, low_stock_threshold, entity_id, created_at')
      .eq('notify_email_daily', true).is('deleted_at', null).not('entity_id', 'is', null)
      .order('created_at', { ascending: true })
    if (params.get('entity')) q = q.eq('entity_id', params.get('entity'))
    const { data: shops, error } = await q
    if (error) throw new Error(error.message)

    const byEntity: Record<string, any[]> = {}
    for (const s of shops || []) (byEntity[s.entity_id] ||= []).push(s)
    const entityIds = Object.keys(byEntity)
    const { data: entities } = entityIds.length ? await admin.from('entities').select('id, owner_user_id').in('id', entityIds) : { data: [] }

    const results: any[] = []
    let firstHtml: string | null = null
    for (const ent of entities || []) {
      if (!ent.owner_user_id) continue
      const days: ShopDay[] = []
      for (const s of byEntity[ent.id]) days.push(await collectShopDay(admin, s, now))
      // Journée sans aucune activité dans toutes ses boutiques : pas d'e-mail
      // (un e-mail vide chaque soir pousse à se désabonner, voire au spam)
      if (!days.some(hasActivity)) { results.push({ entity_id: ent.id, shops: days.map(d => d.name), status: 'no_activity' }); continue }

      const [{ data: owner }, { data: authUser }] = await Promise.all([
        admin.from('profiles').select('full_name, locale').eq('id', ent.owner_user_id).maybeSingle(),
        admin.auth.admin.getUserById(ent.owner_user_id),
      ])
      const email: string | null = authUser?.user?.email ?? null
      // Langue du propriétaire (profiles.locale), français à défaut ; &locale= en simulation
      const i18n = emailI18n((dry && params.get('locale')) || owner?.locale)
      const tz = timeZoneFor(byEntity[ent.id][0].country)
      const dateStr = i18n.date(now, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }, tz)
      const mail = buildEveningSummaryEmail({ ownerName: owner?.full_name ?? null, dateStr, shops: days, appUrl, i18n })
      firstHtml ??= mail.html
      const r: any = { entity_id: ent.id, to: mask(email), locale: i18n.locale, shops: days.map(d => `${d.name} (${d.salesCount})`), subject: mail.subject, status: 'dry' }

      if (!dry) {
        if (!email) r.status = 'no_email'
        else {
          const { error: sendError } = await resend.emails.send({ from: EMAIL_FROM, to: email, subject: mail.subject, html: mail.html })
          r.status = sendError ? `error: ${sendError.message}` : 'sent'
        }
      }
      results.push(r)
    }

    const summary = { dry, owners: results.length, without_activity: results.filter(r => r.status === 'no_activity').length, sent: results.filter(r => r.status === 'sent').length, results }
    if (!dry) await logCronRun('evening-summary', 'success', summary)
    return NextResponse.json(dry && params.get('html') === '1' ? { ...summary, html: firstHtml } : summary)
  } catch (err: any) {
    console.error('[cron/evening-summary]', err)
    if (!dry) await logCronRun('evening-summary', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
