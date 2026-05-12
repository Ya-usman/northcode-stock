import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function DELETE(
  _request: Request,
  { params }: { params: { shopId: string } }
) {
  try {
    const { shopId } = params

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = createAdminClient()

    // Verify the requesting user is the owner of this shop (and it's not already deleted)
    const { data: shop } = await admin
      .from('shops')
      .select('id, owner_id, name, deleted_at')
      .eq('id', shopId)
      .single()

    if (!shop || shop.deleted_at) return NextResponse.json({ error: 'Boutique introuvable' }, { status: 404 })
    if (shop.owner_id !== user.id) {
      return NextResponse.json({ error: "Vous n'êtes pas le propriétaire de cette boutique" }, { status: 403 })
    }

    // Prevent deleting the user's only active shop
    const { count } = await admin
      .from('shops')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)
      .is('deleted_at', null)

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Impossible de supprimer votre seule boutique. Créez-en une autre d'abord." },
        { status: 400 }
      )
    }

    // Soft-delete: set deleted_at instead of hard DELETE
    const { error } = await admin
      .from('shops')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', shopId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/shops/[shopId] — restore a soft-deleted shop (super_admin only)
export async function PATCH(
  _request: Request,
  { params }: { params: { shopId: string } }
) {
  try {
    const { shopId } = params

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if ((profile as any)?.role !== 'super_admin') {
      return NextResponse.json({ error: 'Réservé au support StockShop' }, { status: 403 })
    }

    const admin = createAdminClient()
    const { error } = await admin
      .from('shops')
      .update({ deleted_at: null })
      .eq('id', shopId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
