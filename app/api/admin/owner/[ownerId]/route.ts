import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { getOwnerShopIds } from '@/lib/api/shop-auth'
import { purgeTreatmentPhotos } from '@/lib/api/batch-photos-cleanup'
import { deleteShops } from '@/lib/api/delete-shops'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// DELETE /api/admin/owner/[ownerId]
// Suppression définitive d'un propriétaire et de toutes ses boutiques.
// Réservé au niveau super_admin.
export async function DELETE(
  request: Request,
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
      // Photos de traitement de lot (179) : fichiers privés supprimés AVANT les boutiques ; s'il en reste, ni
      // les boutiques ni le compte ne sont supprimés (pas de références effacées laissant des fichiers orphelins
      // — la base le refuse de toute façon). Storage et la base ne partagent pas de transaction : des fichiers
      // déjà retirés ne sont jamais restaurés. Les autres espaces (photos produits, logos, justificatifs) : suivi
      // séparé.
      const audit = (stage: string, detail: Record<string, unknown>) => writeAuditLog({
        action: 'admin.shop_delete_failed', actor_id: user.id, actor_email: user.email, target_id: ownerId, target_type: 'owner',
        metadata: { route: 'admin/owner', stage, shop_ids: shopIds, ...detail }, ip: getClientIp(request),
      })
      const purge = await purgeTreatmentPhotos(admin, shopIds)
      if (!purge.ok) {
        console.error('[admin/owner] nettoyage des photos de traitement impossible', ownerId, purge.error, purge.remaining.slice(0, 20))
        await audit('photo_purge', { error: purge.error, remaining: purge.remaining.length })
        return NextResponse.json({ error: 'Suppression annulée : les photos de lots n\'ont pas pu être supprimées. Ni les boutiques ni le compte n\'ont été supprimés ; réessayez.', remaining: purge.remaining.length }, { status: 409 })
      }
      const { error: shopsError } = await deleteShops(admin, shopIds)
      if (shopsError) {
        console.error('[admin/owner] suppression des boutiques refusée', ownerId, shopsError.code, shopsError.message, 'photos retirées :', purge.removed)
        await audit('shop_delete', { code: shopsError.code ?? null, message: shopsError.message, photos_removed: purge.removed })
        if (purge.removed > 0) {
          return NextResponse.json({ error: 'Les boutiques n\'ont pas pu être supprimées (le compte non plus). Leurs photos de lots avaient déjà été supprimées et ne peuvent pas être restaurées ; réessayez.', photos_removed: purge.removed, code: shopsError.code ?? null }, { status: 500 })
        }
        return NextResponse.json({ error: shopsError.message, code: shopsError.code ?? null }, { status: 500 })
      }
    }

    // 2. Supprimer l'utilisateur auth (cascade → profiles, shop_members…)
    const { error: authError } = await admin.auth.admin.deleteUser(ownerId)
    if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
