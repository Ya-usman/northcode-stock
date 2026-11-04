import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getAccountForShop } from '@/lib/saas/entity'
import { normalizePhone, cleanDeviceId } from '@/lib/saas/trial-claim'
import { claimTrial } from '@/lib/saas/trial-claim-server'

// POST /api/trial/phone { shop_id, phone, device_id? } — comptes créés par Google / Apple (migration 213) : l'essai
// est EN ATTENTE DU TÉLÉPHONE jusqu'ici. Propriétaire de l'entreprise seulement, une seule fois (état pending_phone).
// Numéro contrôlé selon le pays ; 1 numéro = 1 essai sur 12 mois (sinon compte sans essai, dit clairement).
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'register')
  if (limited) return limited
  const t = getApiTranslator(request)
  const body = await request.json().catch(() => ({}))
  const shopId = String(body?.shop_id || '')
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  if (!account || account.ownerId !== user.id) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
  const { data: ent } = await admin.from('entities').select('trial_status').eq('id', account.entityId).maybeSingle()
  if (ent?.trial_status !== 'pending_phone') return NextResponse.json({ error: t('invalid_data') }, { status: 409 })

  const { data: shop } = await admin.from('shops').select('country, city, whatsapp').eq('id', shopId).maybeSingle()
  const phone = normalizePhone(body?.phone, shop?.country)
  if (!phone) return NextResponse.json({ error: t('phone_invalid'), code: 'phone_invalid' }, { status: 400 })
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

  const trial = await claimTrial(admin, {
    entityId: account.entityId, ownerId: user.id, phone, deviceId: cleanDeviceId(body?.device_id),
    name: profile?.full_name ?? null, city: shop?.city ?? null, country: shop?.country ?? null, source: 'oauth',
  })
  await Promise.all([
    admin.from('profiles').update({ phone }).eq('id', user.id),
    shop?.whatsapp ? null : admin.from('shops').update({ whatsapp: phone }).eq('id', shopId),
  ])
  await writeAuditLog({
    action: 'account.trial_phone', shop_id: shopId, actor_id: user.id, actor_email: user.email, target_id: account.entityId, target_type: 'entity',
    metadata: { trial: trial.granted ? 'granted' : 'refused', flags: trial.flags }, ip: getClientIp(request),
  })
  return NextResponse.json({ ok: true, trial: trial.granted ? 'granted' : 'refused' })
}
