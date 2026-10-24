import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { requireAdmin } from '@/lib/api/require-admin'
import { getApiTranslator } from '@/lib/api/i18n'
import { purgeTreatmentPhotos } from '@/lib/api/batch-photos-cleanup'
import { deleteShops } from '@/lib/api/delete-shops'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// DELETE /api/shops/[shopId] — soft-delete par l'owner
export async function DELETE(
  request: Request,
  { params }: { params: { shopId: string } }
) {
  const t = getApiTranslator(request)
  try {
    const { shopId } = params
    const { user } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const admin = createAdminClient() as any

    const { data: shop } = await admin
      .from('shops').select('id, owner_id, name, deleted_at').eq('id', shopId).single()

    if (!shop || shop.deleted_at) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })
    if (shop.owner_id !== user.id) {
      return NextResponse.json({ error: t('not_shop_owner') }, { status: 403 })
    }

    const { count } = await admin
      .from('shops').select('id', { count: 'exact', head: true })
      .eq('owner_id', user.id).is('deleted_at', null)

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: t('cannot_delete_only_shop') },
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
  request: Request,
  { params }: { params: { shopId: string } }
) {
  const t = getApiTranslator(request)
  try {
    const { shopId } = params
    // Suppression définitive — source de vérité admin_users (requireAdmin),
    // plus l'ancien allowlist email/profiles.role qui pouvait rester actif
    // même après une révocation dans admin_users (voir migration 124).
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error

    const admin = createAdminClient() as any
    const { data: shop } = await admin.from('shops').select('id, deleted_at').eq('id', shopId).single()

    if (!shop) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })
    if (!shop.deleted_at) {
      return NextResponse.json(
        { error: t('shop_must_be_deactivated_first') },
        { status: 400 }
      )
    }

    // Photos de traitement de lot (179) : 1. fichiers de la boutique identifiés, 2. supprimés, 3. absence de
    // résidu vérifiée, 4. seulement ensuite la boutique. Échec du nettoyage → la boutique n'est PAS supprimée.
    // Storage et la base ne partagent pas de transaction : des fichiers déjà retirés ne sont jamais restaurés.
    const audit = (stage: string, detail: Record<string, unknown>) => writeAuditLog({
      action: 'admin.shop_delete_failed', shop_id: shopId, actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: shopId, target_type: 'shop', metadata: { route: 'shops/hard-delete', stage, ...detail }, ip: getClientIp(request),
    })
    const purge = await purgeTreatmentPhotos(admin, [shopId])
    if (!purge.ok) {
      console.error('[shops/hard-delete] nettoyage des photos de traitement impossible', shopId, purge.error, purge.remaining.slice(0, 20))
      await audit('photo_purge', { error: purge.error, remaining: purge.remaining.length })
      return NextResponse.json({ error: t('shop_delete_photos_failed'), remaining: purge.remaining.length }, { status: 409 })
    }
    const { error } = await deleteShops(admin, [shopId])
    if (error) {
      console.error('[shops/hard-delete] suppression de la boutique refusée', shopId, error.code, error.message, 'photos retirées :', purge.removed)
      await audit('shop_delete', { code: error.code ?? null, message: error.message, photos_removed: purge.removed })
      if (purge.removed > 0) {
        return NextResponse.json({ error: t('shop_delete_failed_after_photos'), photos_removed: purge.removed, code: error.code ?? null }, { status: 500 })
      }
      return NextResponse.json({ error: error.message, code: error.code ?? null }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PATCH /api/shops/[shopId] — restaurer un shop soft-deleted (super_admin uniquement)
export async function PATCH(
  request: Request,
  { params }: { params: { shopId: string } }
) {
  const t = getApiTranslator(request)
  try {
    const { shopId } = params
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error

    const admin = createAdminClient() as any
    const { error } = await admin.from('shops').update({ deleted_at: null }).eq('id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
