import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

// DELETE /api/admin/owner/[ownerId]
// Suppression définitive d'un propriétaire et de toutes ses boutiques.
// Réservé au niveau super_admin.
export async function DELETE(
  _request: Request,
  { params }: { params: { ownerId: string } }
) {
  try {
    const { ownerId } = params
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const { user } = auth

    if (ownerId === user.id) {
      return NextResponse.json({ error: 'Impossible de supprimer votre propre compte.' }, { status: 400 })
    }

    const admin = createAdminClient()

    // 1. Supprimer toutes les boutiques (cascade → produits, ventes, clients…)
    const { data: shops } = await admin.from('shops').select('id').eq('owner_id', ownerId)
    if (shops && shops.length > 0) {
      const { error: shopsError } = await admin.from('shops').delete().in('id', shops.map((s: any) => s.id))
      if (shopsError) return NextResponse.json({ error: shopsError.message }, { status: 500 })
    }

    // 2. Supprimer l'utilisateur auth (cascade → profiles, shop_members…)
    const { error: authError } = await admin.auth.admin.deleteUser(ownerId)
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
