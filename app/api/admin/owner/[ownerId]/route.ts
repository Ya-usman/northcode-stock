import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// DELETE /api/admin/owner/[ownerId]
// Suppression définitive d'un propriétaire et de toutes ses boutiques.
// Réservé au super_admin.
export async function DELETE(
  _request: Request,
  { params }: { params: { ownerId: string } }
) {
  try {
    const { ownerId } = params

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if ((profile as any)?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Réservé au support StockShop' }, { status: 403 })
    }

    // Empêcher un super_admin de se supprimer lui-même
    if (ownerId === user.id) {
      return NextResponse.json({ error: 'Impossible de supprimer votre propre compte.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 1. Supprimer toutes les boutiques du propriétaire (cascade → produits, ventes, clients…)
    //    On supprime même les soft-deleted pour tout nettoyer.
    const { data: shops } = await admin
      .from('shops')
      .select('id')
      .eq('owner_id', ownerId)

    if (shops && shops.length > 0) {
      const shopIds = shops.map((s: any) => s.id)
      const { error: shopsError } = await admin
        .from('shops')
        .delete()
        .in('id', shopIds)
      if (shopsError) return NextResponse.json({ error: shopsError.message }, { status: 500 })
    }

    // 2. Supprimer l'utilisateur auth (cascade → profiles, shop_members, etc.)
    const { error: authError } = await admin.auth.admin.deleteUser(ownerId)
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
