import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { emailI18n } from '@/lib/email/i18n'
import { buildOnboardingNudgeEmail } from '@/lib/email/onboarding-nudge-template'
import { decideNudge, unsubscribeToken, NUDGE_WINDOW_DAYS, type NudgeId } from '@/lib/onboarding/nudges'

// Relances « Bien démarrer » — chaque jour vers 9 h (heure de l'Afrique de
// l'Ouest et centrale). Au plus une relance par propriétaire et par passage,
// selon lib/onboarding/nudges.ts (J+1, J+3, J+7, compte de moins de 14 jours,
// arrêt dès que produit et vente existent, désinscription respectée).
//
// EN PAUSE tant que ONBOARDING_NUDGES ne vaut pas « on » : rien n'est envoyé.
// ?dry=1 : calcule sans envoyer ni enregistrer, même en pause
//   (&html=1 : contenu du 1er e-mail ; &locale=en|ha : langue forcée).

const resend = new Resend(process.env.RESEND_API_KEY)
const DAY = 86_400_000
// Adresse de support déjà affichée dans l'app (Aide, Abonnement) ; modifiable par SUPPORT_EMAIL
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@stockshop.tech'
/** Domaines réservés aux exemples et aux tests (RFC 2606 / 6761) : n'existent pas */
const isReservedAddress = (email: string) =>
  /@(?:[^@]+\.)?(example\.(com|net|org)|[^@]+\.(test|example|invalid|localhost))$/i.test(email) || /@localhost$/i.test(email)
const mask = (e: string | null) => (e ? e.replace(/^(.{2}).*(@.*)$/, '$1…$2') : null)

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const dry = params.get('dry') === '1'
  if (!dry && process.env.ONBOARDING_NUDGES !== 'on') {
    await logCronRun('onboarding-nudges', 'success', { paused: true })
    return NextResponse.json({ ok: true, paused: true })
  }

  try {
    const admin = await createAdminClient() as any
    const appUrl = appBaseUrl()
    const now = new Date()

    // Comptes récents : propriétaires d'au moins une boutique créée dans la fenêtre
    const since = new Date(now.getTime() - NUDGE_WINDOW_DAYS * DAY).toISOString()
    const { data: recentShops, error } = await admin.from('shops').select('id').gte('created_at', since).is('deleted_at', null)
    if (error) throw new Error(error.message)
    const recentIds = (recentShops || []).map((s: any) => s.id)
    const { data: recentOwners, error: ownersErr } = recentIds.length
      ? await admin.from('shop_members').select('user_id').in('shop_id', recentIds).eq('role', 'owner')
      : { data: [], error: null }
    if (ownersErr) throw new Error(ownersErr.message)
    const ownerIds = Array.from(new Set((recentOwners || []).map((m: any) => m.user_id))) as string[]

    const results: any[] = []
    let firstHtml: string | null = null
    for (const userId of ownerIds) {
      // TOUTES ses boutiques (un compte ancien qui ouvre une nouvelle boutique n'est pas « récent »)
      const { data: ms, error: msErr } = await admin.from('shop_members').select('shop_id').eq('user_id', userId).eq('role', 'owner')
      if (msErr) throw new Error(msErr.message)
      const shopIds = (ms || []).map((m: any) => m.shop_id)
      const { data: shops, error: shopsErr } = await admin.from('shops')
        .select('id, name, created_at, is_internal, entity_id, deleted_at').in('id', shopIds)
      if (shopsErr) throw new Error(shopsErr.message) // jamais d'oubli silencieux
      const live = (shops || []).filter((s: any) => !s.deleted_at)
      if (!live.length) continue
      // Offre et fins d'essai / d'abonnement : portées par l'entreprise (migration 153)
      const entityIds = Array.from(new Set(live.map((s: any) => s.entity_id).filter(Boolean)))
      const { data: ents, error: entsErr } = entityIds.length
        ? await admin.from('entities').select('id, is_internal, plan, trial_ends_at, plan_expires_at').in('id', entityIds) : { data: [], error: null }
      if (entsErr) throw new Error(entsErr.message)
      // Toute lecture en erreur ARRÊTE la tâche : un « 0 produit » ou un historique
      // d'envois vide par erreur ferait relancer à tort (ou relancer un désinscrit)
      const must = <T,>(r: { data?: T; count?: number | null; error: any }) => { if (r.error) throw new Error(r.error.message); return r }
      const count = async (table: string) => must(await admin.from(table).select('id', { count: 'exact', head: true }).in('shop_id', shopIds)).count ?? 0
      const [products, sales] = await Promise.all([count('products'), count('sales')])
      const [{ data: sentRows }, { data: ob }, { data: profile }] = (await Promise.all([
        admin.from('onboarding_nudges').select('nudge, sent_at').eq('user_id', userId),
        admin.from('user_onboarding').select('nudges_unsubscribed_at').eq('user_id', userId).maybeSingle(),
        admin.from('profiles').select('full_name, locale').eq('id', userId).maybeSingle(),
      ])).map(must) as any[]
      const sent: Partial<Record<NudgeId, Date>> = {}
      for (const r of sentRows || []) sent[r.nudge as NudgeId] = new Date(r.sent_at)
      const ends = (ents || []).map((e: any) => (e.plan === 'trial' || !e.plan ? e.trial_ends_at : e.plan_expires_at)).filter(Boolean).map((d: string) => new Date(d).getTime())

      const decision = decideNudge({
        now,
        accountCreatedAt: new Date(Math.min(...live.map((s: any) => new Date(s.created_at).getTime()))),
        hasProduct: products > 0,
        hasSale: sales > 0,
        sent,
        unsubscribed: !!ob?.nudges_unsubscribed_at,
        internal: live.some((s: any) => s.is_internal) || (ents || []).some((e: any) => e.is_internal),
        billingEndsAt: (() => { const up = ends.filter((e: number) => e > now.getTime() - DAY); return up.length ? new Date(Math.min(...up)) : null })(),
      })
      const r: any = { user: userId.slice(0, 8), products, sales }
      if ('skip' in decision) { results.push({ ...r, status: `skip:${decision.skip}` }); continue }

      const { data: authUser } = await admin.auth.admin.getUserById(userId)
      const email: string | null = authUser?.user?.email ?? null
      // Adresses de test (domaines réservés) : jamais d'envoi — un rejet nuit à la réputation du domaine d'envoi
      if (email && isReservedAddress(email)) { results.push({ ...r, to: mask(email), status: 'skip:test_address' }); continue }
      const i18n = emailI18n((dry && params.get('locale')) || profile?.locale)
      const unsubscribeUrl = `${appUrl}/api/onboarding/unsubscribe?u=${userId}&t=${unsubscribeToken(userId)}&l=${i18n.locale}`
      const mail = buildOnboardingNudgeEmail(i18n, {
        nudge: decision.nudge, variant: decision.variant,
        ownerName: profile?.full_name ?? null, shopName: live[0].name, appUrl, unsubscribeUrl,
        supportEmail: SUPPORT_EMAIL, supportWhatsApp: process.env.SUPPORT_WHATSAPP || null,
      })
      firstHtml ??= mail.html
      Object.assign(r, { to: mask(email), locale: i18n.locale, nudge: decision.nudge, variant: decision.variant, subject: mail.subject, status: 'dry' })

      if (!dry) {
        if (!email) r.status = 'no_email'
        else {
          const { error: sendError } = await resend.emails.send({
            from: EMAIL_FROM, to: email, subject: mail.subject, html: mail.html, text: mail.text,
            reply_to: SUPPORT_EMAIL, // une réponse à la relance arrive au support
            // Désinscription intégrée aux messageries (RFC 8058)
            headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
          })
          if (sendError) r.status = `error: ${sendError.message}`
          else {
            r.status = 'sent'
            await admin.from('onboarding_nudges').insert({ user_id: userId, nudge: decision.nudge, variant: decision.variant })
          }
        }
      }
      results.push(r)
    }

    const summary = { dry, candidates: ownerIds.length, sent: results.filter(r => r.status === 'sent').length, due: results.filter(r => r.nudge).length, results }
    if (!dry) await logCronRun('onboarding-nudges', 'success', summary)
    return NextResponse.json(dry && params.get('html') === '1' ? { ...summary, html: firstHtml } : summary)
  } catch (err: any) {
    console.error('[cron/onboarding-nudges]', err)
    if (!dry) await logCronRun('onboarding-nudges', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
