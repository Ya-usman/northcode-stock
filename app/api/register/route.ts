import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry } from '@/lib/saas/countries'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid, email as emailSchema, shortText } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { notifyReferral } from '@/lib/referrals/notify'
import { getReferralConfig } from '@/lib/referrals/config'
import { assessReferralRisk } from '@/lib/referrals/fraud'
import { getAccountForShop } from '@/lib/saas/entity'
import { normalizePhone, cleanDeviceId } from '@/lib/saas/trial-claim'
import { claimTrial } from '@/lib/saas/trial-claim-server'
import { z } from 'zod'
import { getApiTranslator } from '@/lib/api/i18n'
import { deleteShops } from '@/lib/api/delete-shops'
import { parseChosenOffer } from '@/lib/site/chosen-offer'
import { timezoneForNewShop } from '@/lib/api/shop-timezone'

const registerSchema = z.object({
  password: z.string().min(6),
  full_name: shortText,
  email: emailSchema,
  shop_name: shortText,
  city: shortText,
  // Téléphone OBLIGATOIRE (protection de l'essai, migration 213) : contrôlé selon le pays, enregistré en E.164
  phone: z.string().min(4).max(32),
  device_id: z.string().max(80).optional().nullable(),
  country: z.string().length(2).optional(),
  referral_code: z.string().max(20).optional().nullable(),
  // Fuseau IANA de la boutique (migration 178) : obligatoire pour un pays à plusieurs fuseaux
  timezone: z.string().max(64).optional().nullable(),
  // Formule choisie sur la page Tarifs (préférence d'affichage, lot D du 7 nov. 2026)
  chosen_plan: z.string().max(20).optional().nullable(),
  chosen_period: z.string().max(20).optional().nullable(),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'register')
  if (limited) return limited

  try {
    const body = await request.json()
    const validated = validateBody(registerSchema, body)
    if ('error' in validated) return validated.error
    const { password, full_name, email, shop_name, city, country, referral_code, timezone } = validated.data

    const supabase = await createAdminClient() as any
    const chosenOffer = parseChosenOffer(validated.data.chosen_plan, validated.data.chosen_period)

    const countryConfig = getCountry(country || 'NG')

    // Numéro contrôlé AVANT la création du compte (format réel du pays) ; 1 numéro = 1 essai sur 12 mois (plus bas)
    const phone = normalizePhone(validated.data.phone, countryConfig.code)
    if (!phone) return NextResponse.json({ error: getApiTranslator(request)('phone_invalid'), code: 'phone_invalid' }, { status: 400 })
    const deviceId = cleanDeviceId(validated.data.device_id)

    // Fuseau vérifié AVANT la création du compte : jamais de compte sans boutique (migration 178)
    const tz = await timezoneForNewShop(supabase, getApiTranslator(request), countryConfig.code, timezone)
    if (!tz.ok) return tz.response

    // Create the auth user server-side so the confirmation email only goes out
    // after shop + profile are successfully created (no orphan emails on failure).
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      // chosen_offer : formule et durée vues sur la page Tarifs, proposées en premier à la fin de l'essai (affichage
      // seulement, contrôlées ici ; le prix payé reste calculé par le serveur au moment du paiement)
      user_metadata: { full_name, ...(chosenOffer ? { chosen_offer: { ...chosenOffer, at: new Date().toISOString() } } : {}) },
    })
    if (authError || !authData?.user) {
      return NextResponse.json({ error: authError?.message || 'Erreur création compte' }, { status: 400 })
    }
    const user_id: string = authData.user.id

    // Validate referral code — agent de terrain (existant) OU parrainage
    // utilisateur (migration 127). Les deux systèmes partagent le même
    // espace de codes (voir lib/referrals/generate-code.ts) : un code ne
    // peut jamais matcher les deux à la fois.
    let agentId: string | null = null
    let referrerCodeRow: { id: string; owner_user_id: string } | null = null
    if (referral_code) {
      const codeUpper = referral_code.toUpperCase()
      const { data: agent } = await supabase
        .from('agents')
        .select('id')
        .eq('referral_code', codeUpper)
        .eq('is_active', true)
        .maybeSingle()
      agentId = agent?.id ?? null

      if (!agentId) {
        const { data: refCode } = await supabase
          .from('referral_codes')
          .select('id, owner_user_id')
          .eq('code', codeUpper)
          .eq('active', true)
          .maybeSingle()
        referrerCodeRow = refCode ?? null
      }
    }

    // Create shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .insert({
        name: shop_name,
        owner_id: user_id,
        city,
        state: city,
        whatsapp: phone,
        currency: countryConfig.currency, // code ISO (V3) — jamais le symbole
        country: countryConfig.code,
        billing_country: countryConfig.code,
        agent_id: agentId,
        ...tz.values,
      } as any)
      .select('id')
      .single()

    const cleanup = async (shopId?: string) => {
      if (shopId) await deleteShops(supabase, [shopId])
      await supabase.auth.admin.deleteUser(user_id)
    }

    if (shopError || !shop) {
      await cleanup()
      return NextResponse.json({ error: shopError?.message || 'Erreur création boutique' }, { status: 500 })
    }

    // Profil = la PERSONNE (pays, langue…). L'abonnement d'essai est écrit sur
    // l'ENTREPRISE (créée par le trigger de la migration 153 avec la boutique),
    // juste après le profil — voir plus bas.
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user_id,
        shop_id: shop.id,
        full_name,
        role: 'owner',
        is_active: true,
        country: countryConfig.code,
        phone,
      } as any)

    if (profileError) {
      await cleanup(shop.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // Essai de 30 jours sur l'entreprise (après le profil : sa création ne doit pas l'écraser), SAUF numéro déjà
    // utilisé pour un essai il y a moins de 12 mois : compte créé sans essai (lib/saas/trial-claim, migration 213)
    const account = await getAccountForShop(supabase, shop.id)
    const trial = account
      ? await claimTrial(supabase, { entityId: account.entityId, ownerId: user_id, phone, deviceId, name: full_name, city, country: countryConfig.code, source: 'register' })
      : null

    // Create shop_members entry so RLS lets the owner read their own shop
    const { error: memberError } = await supabase
      .from('shop_members')
      .insert({
        shop_id: shop.id,
        user_id,
        role: 'owner',
        is_active: true,
      } as any)

    if (memberError) {
      await cleanup(shop.id)
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }

    await writeAuditLog({
      action: 'account.register',
      shop_id: shop.id,
      actor_id: user_id,
      actor_email: email,
      target_id: shop.id,
      target_type: 'shop',
      metadata: { shop_name, country, city, referral_code: referral_code ?? null, agent_id: agentId, trial: trial ? (trial.granted ? 'granted' : 'refused') : null, trial_flags: trial?.flags ?? [] },
      ip: getClientIp(request),
    })

    // Association parrain/filleul — après que le compte est entièrement créé
    // et confirmé fonctionnel. Ne doit jamais faire échouer l'inscription :
    // un souci ici prive seulement le parrain d'une récompense, ça ne doit
    // jamais priver le filleul de son compte.
    if (referrerCodeRow) {
      try {
        // Évaluation anti-fraude multi-signaux (jamais l'IP seule) — si le
        // score dépasse le seuil, l'association est retenue pour revue :
        // la récompense sera créée mais ne mûrira pas sans validation admin.
        const config = await getReferralConfig(supabase)
        const risk = config.fraud_auto_hold
          ? await assessReferralRisk(supabase, {
              referrerUserId: referrerCodeRow.owner_user_id,
              referredUserId: user_id,
              referredEmail: email,
              referredPhone: phone,
              referredIp: getClientIp(request),
              maxPerDay: config.max_referrals_per_day,
            })
          : { needsReview: false, flags: [] }

        await supabase.from('referrals').insert({
          referral_code_id: referrerCodeRow.id,
          referrer_user_id: referrerCodeRow.owner_user_id,
          referred_user_id: user_id,
          status: 'registered',
          needs_review: risk.needsReview,
          risk_flags: risk.flags,
        } as any)
        await writeAuditLog({
          action: 'referral.associated',
          shop_id: shop.id,
          actor_id: user_id,
          actor_email: email,
          target_id: referrerCodeRow.owner_user_id,
          target_type: 'profile',
          metadata: {
            referral_code: referral_code?.toUpperCase() ?? null,
            needs_review: risk.needsReview,
            risk_flags: risk.flags.map((f) => f.code),
          },
          ip: getClientIp(request),
        })
        await notifyReferral(supabase, { userId: referrerCodeRow.owner_user_id, event: 'new_referral' })
      } catch (err: any) {
        console.error('[register] referral association failed', err.message)
      }
    }

    return NextResponse.json({ success: true, shop_id: shop.id, trial: trial && !trial.granted ? 'refused' : 'granted' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
