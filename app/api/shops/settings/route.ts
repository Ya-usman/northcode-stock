import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

// PATCH /api/shops/settings — mise à jour des paramètres de la boutique (nom, ville, notifications...)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, ...updates } = await request.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    if (!updates.name?.trim()) return NextResponse.json({ error: 'Le nom de la boutique est requis' }, { status: 400 })

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
