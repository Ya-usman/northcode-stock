import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// PATCH /api/shops/settings — mise à jour des paramètres de la boutique (nom, ville, notifications...)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, ...rawUpdates } = await request.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    if (!rawUpdates.name?.trim()) return NextResponse.json({ error: 'Le nom de la boutique est requis' }, { status: 400 })

    // Liste blanche stricte : sans elle, un propriétaire authentifié pourrait glisser
    // n'importe quelle colonne (billing_country, plan, plan_expires_at, trial_ends_at,
    // owner_id...) dans le corps de la requête et se l'écrire directement en base via
    // le client admin ci-dessous, qui contourne RLS. billing_country reste volontairement
    // exclu — figé à l'inscription, seul le super_admin le modifie (cf. migration 064).
    const ALLOWED_FIELDS = [
      'name', 'city', 'state', 'country', 'currency', 'whatsapp',
      'low_stock_threshold', 'tax_rate', 'expiry_alert_days',
      'notify_email_low_stock', 'notify_email_daily', 'notify_email_expiry',
      'notify_push_new_sale', 'notify_push_new_expense', 'notify_push_expiry',
    ] as const
    const updates: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in rawUpdates) updates[field] = rawUpdates[field]
    }

    // Only the owner can update shop settings
    const { data: member } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!member || !['owner', 'super_admin'].includes(member.role)) {
      return NextResponse.json({ error: 'Seul le propriétaire peut modifier les paramètres de la boutique' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { error } = await admin.from('shops').update(updates).eq('id', shop_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
