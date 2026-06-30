import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, isSuperAdminUser } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/admin/owner — créer un nouveau propriétaire depuis l'admin
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isSuperAdminUser(user.email, (profile as any)?.role)) {
      return NextResponse.json({ error: 'Réservé au support StockShop' }, { status: 403 })
    }

    const body = await request.json()
    const { email, full_name, shop_name, city, country, currency } = body

    if (!email || !full_name || !shop_name) {
      return NextResponse.json({ error: 'email, full_name et shop_name sont requis' }, { status: 400 })
    }

    const admin = createAdminClient() as any
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

    // 1. Inviter l'utilisateur (crée le compte auth et envoie l'email)
    const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${appUrl}/fr/reset-password`,
    })
    if (inviteErr) return NextResponse.json({ error: inviteErr.message }, { status: 400 })

    const userId = invite.user.id
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

    // 2. Créer la boutique
    const { data: shop, error: shopErr } = await admin.from('shops').insert({
      name: shop_name,
      city: city?.trim() || '',
      state: '',
      country: country || 'NG',
      billing_country: country || 'NG',
      currency: currency || '₦',
      owner_id: userId,
      plan: 'trial',
      trial_ends_at: trialEndsAt,
    }).select('id').single()

    if (shopErr) {
      // Rollback: supprimer l'utilisateur invité
      await admin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: shopErr.message }, { status: 500 })
    }

    const shopId = shop.id

    // 3. Mettre à jour le profil (créé automatiquement par trigger)
    await admin.from('profiles').upsert({
      id: userId,
      full_name,
      role: 'owner',
      shop_id: shopId,
      is_active: true,
      trial_ends_at: trialEndsAt,
    }, { onConflict: 'id' })

    // 4. Créer l'entrée shop_members
    await admin.from('shop_members').upsert({
      user_id: userId,
      shop_id: shopId,
      role: 'owner',
      is_active: true,
    }, { onConflict: 'user_id,shop_id' })

    await writeAuditLog({
      action: 'admin.create_owner',
      shop_id: shopId,
      actor_id: user.id,
      actor_email: user.email,
      target_id: userId,
      target_type: 'user',
      metadata: { email, full_name, shop_name, city, country },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, user_id: userId, shop_id: shopId })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
