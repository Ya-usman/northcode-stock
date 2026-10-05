import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isAccountOwner } from '@/lib/team/roles'
import { resolveAccount, getAccountShopIds, checkTeamSeat } from '@/lib/saas/team-quota'
import { listAccountPersonIds, syncPrimaryShop } from '@/lib/api/team-account'
import { z } from 'zod'

const schema = z.object({
  employee_id: uuid,
  is_active: z.boolean(),
  /** Boutique depuis laquelle l'action est faite : sert à identifier le compte */
  shop_id: uuid,
})

// POST /api/team/toggle-active — « Désactiver le compte » / « Réactiver le compte ».
// Désactivation GLOBALE d'une personne dans tout le compte (décision du
// 5 oct. 2026) — à ne pas confondre avec « Retirer de cette boutique »
// (/api/team/delete). Réservée au propriétaire du compte.
//  - Désactiver : toutes ses affectations actives dans les boutiques du
//    compte passent inactives et marquées account_suspended (migration 152) ;
//    profil désactivé + déconnexion de toutes les sessions, sauf si la
//    personne travaille aussi pour un autre compte StockShop (on ne coupe
//    alors que ce compte-ci).
//  - Réactiver : quota vérifié (la personne n'est plus comptée tant qu'elle
//    est désactivée), affectations marquées rétablies à l'identique.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const validated = validateBody(schema, await request.json())
    if ('error' in validated) return validated.error
    const { employee_id, is_active, shop_id } = validated.data

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    if (employee_id === user.id) return NextResponse.json({ error: t('cannot_modify_own_account') }, { status: 400 })

    const callerRole = await checkShopRole(supabase, user.id, shop_id)
    if (!isAccountOwner(callerRole)) return NextResponse.json({ error: t('owner_only_account') }, { status: 403 })

    const admin = createAdminClient() as any
    const account = await resolveAccount(admin, shop_id)
    if (!account?.ownerId) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })
    const ownerId = account.ownerId
    if (employee_id === ownerId) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const people = await listAccountPersonIds(admin, account)
    if (!people.includes(employee_id)) return NextResponse.json({ error: t('member_not_found') }, { status: 404 })

    const accountShopIds = await getAccountShopIds(admin, account, { includeSuspended: true })
    const { data: targetProfile } = await admin.from('profiles').select('full_name, is_active').eq('id', employee_id).maybeSingle()

    let changed = 0
    if (!is_active) {
      const { data: rows, error } = await admin.from('shop_members')
        .update({ is_active: false, account_suspended: true })
        .eq('user_id', employee_id).eq('is_active', true).in('shop_id', accountShopIds)
        .select('id')
      if (error) {
        // Colonne account_suspended absente tant que la migration 152 n'est pas appliquée
        if (/account_suspended/.test(error.message)) return NextResponse.json({ error: t('migration_required') }, { status: 503 })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      changed = rows?.length ?? 0

      // Travaille-t-elle aussi pour un autre compte ?
      const { data: elsewhere } = await admin.from('shop_members')
        .select('id').eq('user_id', employee_id).eq('is_active', true).limit(1)
      if (!elsewhere?.length) {
        await admin.from('profiles').update({ is_active: false }).eq('id', employee_id)
        await admin.auth.admin.signOut(employee_id, 'global').catch(() => {})
      }
    } else {
      const { ok, seats } = await checkTeamSeat(admin, account, employee_id)
      if (!ok) {
        return NextResponse.json(
          { error: t('team_limit_reached', { plan: seats.planName, limit: seats.limit }), code: 'team_limit' },
          { status: 403 }
        )
      }
      const { data: rows, error } = await admin.from('shop_members')
        .update({ is_active: true, account_suspended: false })
        .eq('user_id', employee_id).eq('account_suspended', true).eq('suspended_by_plan', false).in('shop_id', accountShopIds)
        .select('id')
      if (error) {
        if (/account_suspended/.test(error.message)) return NextResponse.json({ error: t('migration_required') }, { status: 503 })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      changed = rows?.length ?? 0
      // Désactivation faite avant la migration 152 (ancienne route) : on rétablit
      // au moins l'affectation de la boutique d'où l'action est faite.
      if (!changed) {
        const { data: legacy } = await admin.from('shop_members')
          .update({ is_active: true })
          .eq('user_id', employee_id).eq('shop_id', shop_id).eq('is_active', false).eq('suspended_by_plan', false)
          .select('id')
        changed = legacy?.length ?? 0
      }
      await admin.from('profiles').update({ is_active: true }).eq('id', employee_id)
    }

    await syncPrimaryShop(admin, employee_id, shop_id)

    await writeAuditLog({
      action: 'member.toggle_active',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: employee_id,
      target_type: 'profile',
      metadata: {
        member_name: targetProfile?.full_name ?? null,
        old_active: targetProfile?.is_active ?? null,
        new_active: is_active,
        scope: 'account',
        shops_changed: changed,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, shops_changed: changed })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
