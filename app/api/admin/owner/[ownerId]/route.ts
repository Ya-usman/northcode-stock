import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { getOwnerShopIds } from '@/lib/api/shop-auth'

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
    // Résolu via shop_members (source de vérité), PAS shops.owner_id — cette
    // colonne a `on delete set null` et peut donc pointer vers un compte déjà
    // supprimé alors que le vrai propriétaire actuel est quelqu'un d'autre
    // (voir migration 105) ; filtrer dessus risquerait de supprimer la
    // boutique d'un AUTRE utilisateur qui partage juste cette référence
    // périmée.
    const shopIds = await getOwnerShopIds(admin, ownerId)
    if (shopIds.length > 0) {
      const { error: shopsError } = await (admin as any).from('shops').delete().in('id', shopIds)
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
