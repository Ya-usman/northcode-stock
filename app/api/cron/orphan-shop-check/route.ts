import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/api/audit'
import { logCronRun } from '@/lib/api/cron-log'

/**
 * Filet de sécurité contre les boutiques orphelines (`shops.owner_id` NULL
 * alors qu'un propriétaire actif existe bien via `shop_members`).
 *
 * `shops.owner_id` a `ON DELETE SET NULL` (migration 001) : elle se vide
 * silencieusement si le compte auth qu'elle référence est supprimé sans
 * passer par un des chemins vérifiés (voir lib/api/shop-auth.ts). Ce cas
 * s'est déjà produit plusieurs fois par le passé (migration 105) et devait
 * être repéré et réparé à la main. Cette tâche automatise la détection —
 * et répare directement les cas non ambigus (exactement un propriétaire
 * actif retrouvable via shop_members).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const admin = await createAdminClient() as any

    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name')
      .is('owner_id', null)
      .is('deleted_at', null)

    if (shopsError) throw new Error(shopsError.message)
    if (!shops?.length) {
      await logCronRun('orphan-shop-check', 'success', { checked: 0, repaired: 0, flagged: 0 })
      return NextResponse.json({ checked: 0, repaired: 0, flagged: 0 })
    }

    let repaired = 0
    let flagged = 0

    for (const shop of shops as { id: string; name: string }[]) {
      const { data: owners } = await admin
        .from('shop_members')
        .select('user_id')
        .eq('shop_id', shop.id)
        .eq('role', 'owner')
        .eq('is_active', true)

      if (owners?.length === 1) {
        // Cas non ambigu — on répare, comme la migration 105 l'avait fait à la main.
        const ownerId = owners[0].user_id
        const { error: updateError } = await admin
          .from('shops')
          .update({ owner_id: ownerId })
          .eq('id', shop.id)

        if (!updateError) {
          repaired++
          await writeAuditLog({
            action: 'admin.repair_orphan_shop',
            shop_id: shop.id,
            actor_email: 'Tâche automatique',
            target_id: shop.id,
            target_type: 'shop',
            metadata: { name: shop.name, repaired_owner_id: ownerId },
          })
        }
      } else {
        // 0 ou plusieurs candidats — ambigu, pas de réparation auto, juste
        // une trace pour qu'un admin regarde dans le Journal d'audit.
        flagged++
        await writeAuditLog({
          action: 'admin.orphan_shop_alert',
          shop_id: shop.id,
          actor_email: 'Tâche automatique',
          target_id: shop.id,
          target_type: 'shop',
          metadata: { name: shop.name, active_owner_candidates: owners?.length ?? 0 },
        })
      }
    }

    await logCronRun('orphan-shop-check', 'success', { checked: shops.length, repaired, flagged })
    return NextResponse.json({ checked: shops.length, repaired, flagged })
  } catch (err: any) {
    await logCronRun('orphan-shop-check', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
