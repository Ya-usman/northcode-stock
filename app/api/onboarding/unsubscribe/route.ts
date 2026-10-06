import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyUnsubscribeToken } from '@/lib/onboarding/nudges'
import { emailI18n } from '@/lib/email/i18n'
import { emailShell, esc } from '@/lib/email/brand'
import { appBaseUrl } from '@/lib/email/sender'

// Désinscription des relances « Bien démarrer » (migration 164).
//  GET  : lien en bas de l'e-mail → page de confirmation ;
//  POST : désinscription « en un clic » des messageries (RFC 8058, en-tête
//         List-Unsubscribe-Post), sans page.
// Lien signé (HMAC) : impossible à deviner pour un autre compte. Aucune session requise.

async function unsubscribe(userId: string) {
  const admin = await createAdminClient() as any
  const now = new Date().toISOString()
  const { error } = await admin.from('user_onboarding')
    .upsert({ user_id: userId, nudges_unsubscribed_at: now, updated_at: now }, { onConflict: 'user_id' })
  return !error
}

function page(locale: string | null, ok: boolean, status: number) {
  const i = emailI18n(locale)
  const t = (k: string) => i.t(`onboarding.${k}`)
  const appUrl = appBaseUrl()
  const body = `<p style="margin:0 0 6px;font-size:18px;font-weight:700;color:#111827;">${esc(ok ? t('unsub_done_title') : t('unsub_invalid_title'))}</p>
    <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.55;">${esc(ok ? t('unsub_done_body') : t('unsub_invalid_body'))}</p>
    <p style="margin:0 0 18px;"><a href="${appUrl}/${i.locale}/dashboard" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:600;font-size:14px;">${esc(t('unsub_open_app'))}</a></p>`
  return new NextResponse(emailShell({ appUrl, body, footer: '', lang: i.locale }), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' } })
}

export async function GET(request: Request) {
  const p = new URL(request.url).searchParams
  const userId = p.get('u') || '', token = p.get('t') || '', locale = p.get('l')
  if (!verifyUnsubscribeToken(userId, token)) return page(locale, false, 400)
  return page(locale, await unsubscribe(userId), 200)
}

export async function POST(request: Request) {
  const p = new URL(request.url).searchParams
  const userId = p.get('u') || '', token = p.get('t') || ''
  if (!verifyUnsubscribeToken(userId, token)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  return (await unsubscribe(userId)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'failed' }, { status: 500 })
}
