import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { writeAuditLog } from '@/lib/api/audit'
import { getLocaleTranslator, normalizeLocale } from '@/lib/api/i18n'
import { getPlan } from '@/lib/saas/plans'
import { reminderToSend, type ReminderStage } from '@/lib/saas/grants'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { countTeamSeats, getShopLimit } from '@/lib/saas/team-quota'

// Rappel de fin des gestes commerciaux (migration 157) — chaque matin.
//  • Au propriétaire de l'entreprise, dans sa langue : notification push
//    (ses appareils) + e-mail, à 7 jours puis la veille de la fin.
//  • Aux administrateurs : récapitulatif des rappels envoyés (e-mail).
// Un rappel n'est jamais envoyé deux fois (journal billing.grant_expiry_reminder).
// ?dry=1 : calcule et renvoie ce qui serait envoyé, sans rien envoyer ni journaliser
// (&now=<date ISO> pour simuler un autre jour).

const resend = new Resend(process.env.RESEND_API_KEY)
const DAY = 86_400_000
const DATE_LOCALE = { fr: 'fr-FR', en: 'en-GB', ha: 'ha-NG' } as const

function formatDate(iso: string, locale: keyof typeof DATE_LOCALE): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
  try { return new Date(iso).toLocaleDateString(DATE_LOCALE[locale], opts) } catch { return new Date(iso).toLocaleDateString('fr-FR', opts) }
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

interface Reminder {
  grant_id: string
  entity_id: string
  entity_name: string
  stage: ReminderStage
  kind: 'team_seats' | 'shops'
  quantity: number
  expires_at: string
  used: number
  limit_after: number
  over: number
  owner_email: string | null
  locale: string
  title: string
  body: string
  push: string
  email: string
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'

  try {
    const admin = await createAdminClient() as any
    // En simulation seulement : ?now=<date ISO> pour voir ce que la tâche enverrait ce jour-là
    const simulated = dry && params.get('now') ? new Date(params.get('now')!) : null
    const now = simulated && !Number.isNaN(simulated.getTime()) ? simulated : new Date()
    const { data: grants, error } = await admin.from('entity_grants')
      .select('id, entity_id, kind, quantity, expires_at, revoked_at')
      .is('revoked_at', null).not('expires_at', 'is', null)
      .gt('expires_at', now.toISOString()).lte('expires_at', new Date(now.getTime() + 7 * DAY).toISOString())
    if (error) throw new Error(error.message)

    const { data: logs } = await admin.from('audit_logs').select('metadata')
      .eq('action', 'billing.grant_expiry_reminder').gte('created_at', new Date(now.getTime() - 14 * DAY).toISOString())
    const sent = new Set<string>((logs || []).map((l: any) => `${l.metadata?.grant_id}:${l.metadata?.stage}`))

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stockshop.tech'
    const canPush = !!(process.env.VAPID_MAILTO && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    if (canPush && !dry) webpush.setVapidDetails(process.env.VAPID_MAILTO!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

    const reminders: Reminder[] = []
    for (const g of grants || []) {
      const stage = reminderToSend(g, sent, now)
      if (!stage) continue

      const { data: shops } = await admin.from('shops').select('id').eq('entity_id', g.entity_id).is('deleted_at', null).order('created_at', { ascending: true })
      if (!shops?.length) continue
      const account = await getAccountForShop(admin, shops[0].id)
      if (!account) continue
      const plan = getPlan(account.plan)

      // Situation à la fin du geste : limite effective moins ce geste
      let used: number, limitNow: number
      if (g.kind === 'team_seats') {
        const seats = await countTeamSeats(admin, account)
        used = seats.used; limitNow = seats.limit
      } else {
        const [ids, lim] = await Promise.all([getEntityShopIds(admin, account, { includeSuspended: true }), getShopLimit(admin, account)])
        used = ids.length; limitNow = lim.limit
      }
      if (limitNow === -1) continue // illimité : la fin du geste ne change rien
      const limitAfter = Math.max(0, limitNow - g.quantity)
      const over = Math.max(0, used - limitAfter)

      const { data: owner } = account.ownerId
        ? await admin.from('profiles').select('full_name, locale').eq('id', account.ownerId).maybeSingle()
        : { data: null }
      const { data: authUser } = account.ownerId ? await admin.auth.admin.getUserById(account.ownerId) : { data: null }
      const locale = normalizeLocale(owner?.locale)
      const t = getLocaleTranslator(locale, 'grant_reminder')
      const date = formatDate(g.expires_at, locale)
      const members = g.kind === 'team_seats'
      const title = t('title', { date })
      const body = [
        t(members ? 'members_body' : 'shops_body', { entity: account.name || '', count: g.quantity, date, plan: plan.name, limit: limitAfter, used }),
        over > 0 ? t(members ? 'members_over' : 'shops_over', { over }) : t('within_limit'),
      ].join(' ')

      const r: Reminder = {
        grant_id: g.id, entity_id: g.entity_id, entity_name: account.name || '', stage, kind: g.kind, quantity: g.quantity,
        expires_at: g.expires_at, used, limit_after: limitAfter, over,
        owner_email: authUser?.user?.email ?? null, locale, title, body, push: 'skipped', email: 'skipped',
      }

      if (!dry) {
        // Push : appareils du propriétaire dans les boutiques de l'entreprise
        if (canPush && account.ownerId) {
          const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth')
            .eq('user_id', account.ownerId).in('shop_id', shops.map((s: any) => s.id))
          if (subs?.length) {
            const payload = JSON.stringify({ title, body, tag: `grant-${g.id}-${stage}`, url: members ? '/team' : '/billing' })
            const res = await Promise.allSettled(subs.map((s: any) => webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)))
            const gone = subs.filter((_: any, i: number) => res[i].status === 'rejected' && (res[i] as any).reason?.statusCode === 410).map((s: any) => s.endpoint)
            if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone)
            r.push = `${res.filter(x => x.status === 'fulfilled').length}/${subs.length}`
          } else r.push = 'no_device'
        }
        // E-mail au propriétaire
        if (r.owner_email && process.env.RESEND_API_KEY) {
          const cta = members ? t('cta_team') : t('cta_billing')
          const href = `${appUrl}/${locale}/${members ? 'team' : 'billing'}`
          const { error: mailError } = await resend.emails.send({
            from: 'StockShop <no-reply@stockshop.tech>',
            to: r.owner_email,
            subject: t('email_subject', { date }),
            html: `
              <p>${esc(t('greeting', { name: owner?.full_name || '' }))}</p>
              <p>${esc(body)}</p>
              <p><a href="${href}" style="background:#073e8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">${esc(cta)}</a></p>
              <p style="color:#666;font-size:12px;">${esc(t('footer'))}</p>`,
          })
          r.email = mailError ? `error: ${mailError.message}` : 'sent'
        } else if (!r.owner_email) r.email = 'no_owner_email'

        await writeAuditLog({
          action: 'billing.grant_expiry_reminder', shop_id: shops[0].id, target_id: g.entity_id, target_type: 'entity',
          metadata: { grant_id: g.id, stage, kind: g.kind, quantity: g.quantity, expires_at: g.expires_at, used, limit_after: limitAfter, over, push: r.push, email: r.email },
        })
        sent.add(`${g.id}:${stage}`)
      }
      reminders.push(r)
    }

    // Récapitulatif aux administrateurs (pour agir avant la fin : désactivation, formule…)
    const adminEmails = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
    if (!dry && reminders.length && adminEmails.length && process.env.RESEND_API_KEY) {
      const rows = reminders.map(r => `<li><strong>${esc(r.entity_name)}</strong> — +${r.quantity} ${r.kind === 'team_seats' ? 'membre(s)' : 'boutique(s)'} jusqu'au ${esc(formatDate(r.expires_at, 'fr'))} · ensuite ${r.used} / ${r.limit_after}${r.over ? ` · <span style="color:#b45309">${r.over} en trop</span>` : ''} · propriétaire : push ${r.push}, e-mail ${r.email}</li>`).join('')
      await resend.emails.send({
        from: 'StockShop <no-reply@stockshop.tech>',
        to: adminEmails,
        subject: `Gestes commerciaux : ${reminders.length} fin(s) prochaine(s)`,
        html: `<p>Rappels envoyés ce matin aux propriétaires :</p><ul>${rows}</ul><p style="color:#666;font-size:12px;">Détail et retrait : Admin → fiche boutique → Facturation → Gestes commerciaux.</p>`,
      }).catch(() => {})
    }

    const summary = { dry, checked: (grants || []).length, reminders: reminders.map(({ title, body, ...r }) => r) }
    if (!dry) await logCronRun('grant-reminders', 'success', summary)
    return NextResponse.json(dry ? { ...summary, preview: reminders.map(r => ({ grant_id: r.grant_id, title: r.title, body: r.body })) } : summary)
  } catch (err: any) {
    console.error('[cron/grant-reminders]', err)
    if (!dry) await logCronRun('grant-reminders', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
