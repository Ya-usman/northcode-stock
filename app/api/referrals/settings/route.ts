import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getOrCreateWallet } from '@/lib/referrals/wallet'

// PATCH /api/referrals/settings — bascule "utiliser automatiquement mes
// récompenses au prochain renouvellement" (OFF par défaut, point 14).
// Requêtes indépendantes groupées (profil + portefeuille + lecture du
// corps de la requête) — un simple interrupteur ne doit jamais imposer
// plusieurs aller-retours séquentiels avant de répondre.
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = await createAdminClient() as any

    const [{ data: profile }, wallet, body] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).single(),
      getOrCreateWallet(admin, user.id),
      request.json(),
    ])

    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }

    const { auto_apply_to_subscription } = body
    if (typeof auto_apply_to_subscription !== 'boolean') {
      return NextResponse.json({ error: 'auto_apply_to_subscription doit être un booléen' }, { status: 400 })
    }

    if (wallet.frozen) {
      return NextResponse.json({ error: 'Portefeuille gelé — contactez le support' }, { status: 403 })
    }

    const { error } = await admin
      .from('referral_wallets').update({ auto_apply_to_subscription }).eq('id', wallet.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, auto_apply_to_subscription })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
