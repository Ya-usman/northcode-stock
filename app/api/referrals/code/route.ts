import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { generateUniqueReferralCode } from '@/lib/referrals/generate-code'
import { getReferralConfig } from '@/lib/referrals/config'

// GET /api/referrals/code — récupère (ou crée à la volée) le code de
// parrainage du owner connecté. "Activation" du programme pour un
// utilisateur = sa première visite sur Paramètres > Parrainage, pas une
// création systématique pour tous les comptes.
export async function GET() {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', user.id).single()
    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const config = await getReferralConfig(admin)
    if (!config.enabled) {
      return NextResponse.json({ error: 'Le programme de parrainage n\'est pas actif actuellement' }, { status: 403 })
    }

    const { data: existing } = await admin
      .from('referral_codes').select('id, code, active').eq('owner_user_id', user.id).maybeSingle()
    if (existing) {
      return NextResponse.json({ code: existing.code, active: existing.active })
    }

    const code = await generateUniqueReferralCode(admin, (profile as any)?.full_name || '')
    const { data: created, error } = await admin
      .from('referral_codes')
      .insert({ owner_user_id: user.id, code })
      .select('code, active')
      .single()

    if (error) {
      // Course possible entre deux requêtes concurrentes (owner_user_id UNIQUE) —
      // relire plutôt que d'échouer.
      const { data: raceExisting } = await admin
        .from('referral_codes').select('code, active').eq('owner_user_id', user.id).maybeSingle()
      if (raceExisting) return NextResponse.json(raceExisting)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(created)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
