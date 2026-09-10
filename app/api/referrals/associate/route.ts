import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, getOwnerShopIds } from '@/lib/api/shop-auth'
import { getReferralConfig } from '@/lib/referrals/config'
import { assessReferralRisk } from '@/lib/referrals/fraud'
import { notifyReferral } from '@/lib/referrals/notify'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/referrals/associate — ajoute un code de parrainage APRÈS
// l'inscription (réactive fonctionnellement association_window_days).
//
// Toute la validation est serveur. Une fois associé, aucun endpoint ne
// permet de changer le code (contrainte UNIQUE(referred_user_id) + pas de
// route de modification).
export async function POST(request: Request) {
  const { user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

  let body: any
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Corps invalide' }, { status: 400 }) }
  const code = String(body?.code || '').trim().toUpperCase()
  if (!code) return NextResponse.json({ error: 'Code requis' }, { status: 400 })

  const admin = await createAdminClient() as any

  const [{ data: profile }, config] = await Promise.all([
    admin.from('profiles').select('role, full_name, phone, created_at').eq('id', user.id).maybeSingle(),
    getReferralConfig(admin),
  ])

  if (profile?.role !== 'owner') {
    return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
  }
  if (!config.enabled || config.association_window_days <= 0) {
    return NextResponse.json({ error: "L'ajout d'un code de parrainage n'est pas disponible" }, { status: 403 })
  }

  // 1. Déjà un parrain ?
  const { data: existing } = await admin.from('referrals').select('id').eq('referred_user_id', user.id).maybeSingle()
  if (existing) {
    return NextResponse.json({ error: 'Un parrain est déjà associé à votre compte' }, { status: 409 })
  }

  // 2. Encore dans la fenêtre d'association ?
  const createdAt = profile?.created_at ? new Date(profile.created_at).getTime() : Date.now()
  const deadline = createdAt + config.association_window_days * 86_400_000
  if (Date.now() > deadline) {
    return NextResponse.json({ error: 'Le délai pour ajouter un code de parrainage est dépassé' }, { status: 403 })
  }

  // 3. Aucun abonnement payant déjà actif — sinon une association tardive
  // pourrait récompenser un renouvellement au lieu d'un vrai premier paiement.
  const shopIds = await getOwnerShopIds(admin, user.id)
  if (shopIds.length > 0) {
    const { data: paidSub } = await admin
      .from('subscriptions').select('id')
      .in('shop_id', shopIds).neq('gateway', 'wallet_credit').gt('amount', 0)
      .limit(1).maybeSingle()
    if (paidSub) {
      return NextResponse.json({ error: 'Vous avez déjà un abonnement payant — un code de parrainage ne peut plus être ajouté' }, { status: 409 })
    }
  }

  // 4. Code de parrainage utilisateur valide + actif (les codes « agent de
  // terrain » ne sont éligibles qu'au moment de l'inscription).
  const { data: codeRow } = await admin
    .from('referral_codes').select('id, owner_user_id').eq('code', code).eq('active', true).maybeSingle()
  if (!codeRow) {
    return NextResponse.json({ error: 'Code de parrainage invalide ou inactif' }, { status: 404 })
  }

  // 5. Pas d'auto-parrainage
  if (codeRow.owner_user_id === user.id) {
    return NextResponse.json({ error: 'Vous ne pouvez pas utiliser votre propre code' }, { status: 400 })
  }

  // 6. Anti-fraude (mêmes règles qu'à l'inscription — jamais l'IP seule)
  const risk = config.fraud_auto_hold
    ? await assessReferralRisk(admin, {
        referrerUserId: codeRow.owner_user_id,
        referredUserId: user.id,
        referredEmail: user.email || '',
        referredPhone: profile?.phone ?? null,
        referredIp: getClientIp(request),
        maxPerDay: config.max_referrals_per_day,
      })
    : { needsReview: false, flags: [] }

  // 7. Insertion — la contrainte UNIQUE(referred_user_id) tranche toute
  // course entre deux requêtes concurrentes.
  const { error: insErr } = await admin.from('referrals').insert({
    referral_code_id: codeRow.id,
    referrer_user_id: codeRow.owner_user_id,
    referred_user_id: user.id,
    status: 'registered',
    needs_review: risk.needsReview,
    risk_flags: risk.flags,
  })
  if (insErr) {
    if ((insErr as any).code === '23505') {
      return NextResponse.json({ error: 'Un parrain est déjà associé à votre compte' }, { status: 409 })
    }
    return NextResponse.json({ error: insErr.message }, { status: 500 })
  }

  await writeAuditLog({
    action: 'referral.associated',
    actor_id: user.id,
    actor_email: user.email,
    target_id: codeRow.owner_user_id,
    target_type: 'profile',
    metadata: {
      referral_code: code,
      method: 'post_registration',
      needs_review: risk.needsReview,
      risk_flags: risk.flags.map((f: any) => f.code),
    },
    ip: getClientIp(request),
  })
  await notifyReferral(admin, { userId: codeRow.owner_user_id, event: 'new_referral' })

  return NextResponse.json({ success: true, needs_review: risk.needsReview })
}
