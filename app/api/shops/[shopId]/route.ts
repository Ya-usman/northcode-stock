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

    // Verify the requesting user is the owner of this shop
    const { data: shop } = await admin
      .from('shops')
      .select('id, owner_id, name')
      .eq('id', shopId)
      .single()

    if (!shop) return NextResponse.json({ error: 'Boutique introuvable' }, { status: 404 })
    if (shop.owner_id !== user.id) {
      return NextResponse.json({ error: 'Vous n\'êtes pas le propriétaire de cette boutique' }, { status: 403 })
    }

    // Prevent deleting if it's the user's only shop
    const { count } = await admin
      .from('shops')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id)

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Impossible de supprimer votre seule boutique. Créez-en une autre d\'abord.' },
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
