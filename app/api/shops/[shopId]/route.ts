import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, isSuperAdminUser } from '@/lib/api/shop-auth'

// DELETE /api/shops/[shopId] — soft-delete par l'owner
export async function DELETE(
  _request: Request,
  { params }: { params: { shopId: string } }
) {
  try {
    const { shopId } = params
    const { user } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const admin = createAdminClient() as any

    const { data: shop } = await admin
      .from('shops').select('id, owner_id, name, deleted_at').eq('id', shopId).single()

    if (!shop || shop.deleted_at) return NextResponse.json({ error: 'Boutique introuvable' }, { status: 404 })
    if (shop.owner_id !== user.id) {
      return NextResponse.json({ error: "Vous n'êtes pas le propriétaire de cette boutique" }, { status: 403 })
    }

    const { count } = await admin
      .from('shops').select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id).is('deleted_at', null)

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Impossible de supprimer votre seule boutique. Créez-en une autre d'abord." },
        { status: 400 }
      )
    }

    const { error } = await admin
      .from('shops').update({ deleted_at: new Date().toISOString() }).eq('id', shopId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // If the deleted shop was the user's primary shop (profile.shop_id),
    // redirect profile.shop_id to the next active shop so plan lookups stay valid.
    const { data: profile } = await admin
      .from('profiles').select('shop_id').eq('id', user.id).single()

    if ((profile as any)?.shop_id === shopId) {
      const { data: nextShop } = await admin
        .from('shops')
        .select('id')
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .neq('id', shopId)
        .order('created_at', { ascending: true })
        .limit(1)
        .single()

      if (nextShop) {
        await admin.from('profiles').update({ shop_id: (nextShop as any).id }).eq('id', user.id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/shops/[shopId] — hard-delete définitive (super_admin uniquement)
export async function POST(
  _request: Request,
  { params }: { params: { shopId: string } }
) {
  try {
    const { shopId } = params
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isSuperAdminUser(user.email, (profile as any)?.role)) {
      return NextResponse.json({ error: 'Réservé au support StockShop' }, { status: 403 })
    }

    const admin = createAdminClient() as any
    const { data: shop } = await admin.from('shops').select('id, deleted_at').eq('id', shopId).single()

    if (!shop) return NextResponse.json({ error: 'Boutique introuvable' }, { status: 404 })
    if (!shop.deleted_at) {
      return NextResponse.json(
        { error: "La boutique doit d'abord être désactivée avant suppression définitive." },
        { status: 400 }
      )
    }

    const { error } = await admin.from('shops').delete().eq('id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/shops/[shopId] — restaurer un shop soft-deleted (super_admin uniquement)
export async function PATCH(
  _request: Request,
  { params }: { params: { shopId: string } }
) {
  try {
    const { shopId } = params
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (!isSuperAdminUser(user.email, (profile as any)?.role)) {
      return NextResponse.json({ error: 'Réservé au support StockShop' }, { status: 403 })
    }

    const admin = createAdminClient() as any
    const { error } = await admin.from('shops').update({ deleted_at: null }).eq('id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
