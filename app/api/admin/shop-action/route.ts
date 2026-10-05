import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getOwnerShopIds } from '@/lib/api/shop-auth'
import { requireAdmin } from '@/lib/api/require-admin'
import { getAccountForShop, setAccountPlan } from '@/lib/saas/entity'
import { normalizeCurrency, currencyCodeForCountry } from '@/lib/saas/currencies'

export async function POST(request: Request) {
  try {
    // Toutes les actions de cette route sont des mutations (suspendre,
    // prolonger, attribuer un plan...) — réservées au niveau super_admin,
    // jamais accessibles au niveau support (lecture seule).
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const { user } = auth

    const body = await request.json()
    const { action, shop_id, days, name, city, country, whatsapp, currency, internal } = body
    if (!action || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Get owner_id for profile-level updates — via shop_members d'abord (fiable),
    // shops.owner_id en repli seulement (peut être null, voir getOwnerShopIds).
    const { data: ownerMember } = await admin
      .from('shop_members').select('user_id').eq('shop_id', shop_id).eq('role', 'owner').eq('is_active', true).maybeSingle()
    const { data: targetShop } = await admin.from('shops').select('owner_id').eq('id', shop_id).single()
    const owner_id = ownerMember?.user_id ?? (targetShop as any)?.owner_id
    // Abonnement de l'ENTREPRISE de la boutique (source de vérité, migration 153)
    const account = await getAccountForShop(admin, shop_id)
    // Les actions sur l'abonnement portent sur l'entreprise : sans elle, refus
    // explicite (jamais un « succès » qui n'aurait rien modifié).
    const PLAN_ACTIONS = ['suspend', 'reactivate', 'extend', 'grant_plan']
    if (PLAN_ACTIONS.includes(action) && !account) {
      return NextResponse.json({ error: 'Boutique sans entreprise rattachée' }, { status: 409 })
    }

    switch (action) {
      case 'suspend': {
        // L'abonnement appartient à l'entreprise : le faire expirer touche
        // nécessairement toutes ses boutiques, pas seulement celle-ci.
        if (!owner_id) return NextResponse.json({ error: 'Boutique sans propriétaire résolu' }, { status: 400 })
        const expiredAt = new Date(Date.now() - 1000).toISOString()
        // Deactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: false }).eq('shop_id', shop_id)
        await setAccountPlan(admin, account!, { plan_expires_at: expiredAt, trial_ends_at: expiredAt })
        await writeAuditLog({ action: 'admin.suspend_shop', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: 'Shop suspended' })
      }

      case 'reactivate': {
        if (!owner_id) return NextResponse.json({ error: 'Boutique sans propriétaire résolu' }, { status: 400 })
        const newTrial = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        // Reactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: true }).eq('shop_id', shop_id)
        await setAccountPlan(admin, account!, { plan: 'trial', plan_expires_at: null, trial_ends_at: newTrial })
        await writeAuditLog({ action: 'admin.reactivate_shop', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: 'Shop reactivated' })
      }

      case 'extend': {
        if (!owner_id) return NextResponse.json({ error: 'Boutique sans propriétaire résolu' }, { status: 400 })
        const daysToAdd = Number(days) || 30
        const hasActivePlan = !!account!.plan && account!.plan !== 'trial' && !!account!.plan_expires_at && new Date(account!.plan_expires_at) > new Date()

        if (hasActivePlan) {
          const current = new Date(account!.plan_expires_at as string)
          current.setDate(current.getDate() + daysToAdd)
          const newExpiry = current.toISOString()
          await setAccountPlan(admin, account!, { plan_expires_at: newExpiry })
        } else {
          const current = account!.trial_ends_at ? new Date(account!.trial_ends_at) : new Date()
          if (current < new Date()) current.setTime(Date.now())
          current.setDate(current.getDate() + daysToAdd)
          const newTrial = current.toISOString()
          await setAccountPlan(admin, account!, { trial_ends_at: newTrial })
        }
        await writeAuditLog({ action: 'admin.extend_access', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', metadata: { days: daysToAdd }, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: `Extended by ${daysToAdd} days` })
      }

      case 'grant_plan': {
        if (!owner_id) return NextResponse.json({ error: 'Boutique sans propriétaire résolu' }, { status: 400 })
        const planId = days // reuse 'days' param for plan id
        const expires = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
        await admin.from('profiles').update({ is_active: true }).eq('shop_id', shop_id)
        await setAccountPlan(admin, account!, { plan: planId, plan_expires_at: expires, trial_ends_at: null })
        await writeAuditLog({ action: 'admin.grant_plan', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', metadata: { plan: planId }, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: `Plan ${planId} granted` })
      }

      case 'set_internal': {
        const isInternal = !!internal
        // entities.is_internal fait foi (migration 153) ; profiles.is_internal
        // (accès de la personne) et shops.is_internal (lecture directe côté
        // boutique) restent alignés sur toutes les boutiques non supprimées.
        if (owner_id) {
          await admin.from('profiles').update({ is_internal: isInternal } as any).eq('id', owner_id)
          // Compte interne = propriété de l'ENTREPRISE (migration 153)
          if (account?.entityId) await admin.from('entities').update({ is_internal: isInternal }).eq('id', account.entityId)
          // via shop_members (fiable) — shops.owner_id peut être null, voir
          // lib/api/shop-auth.ts:getOwnerShopIds.
          const ownerShopIds = await getOwnerShopIds(admin, owner_id)
          if (ownerShopIds.length > 0) {
            await admin.from('shops').update({ is_internal: isInternal } as any).in('id', ownerShopIds).is('deleted_at', null)
          }
        } else {
          await admin.from('shops').update({ is_internal: isInternal } as any).eq('id', shop_id)
        }
        await writeAuditLog({ action: 'admin.set_internal', shop_id, actor_id: user.id, actor_email: user.email, target_id: owner_id || shop_id, target_type: owner_id ? 'owner' : 'shop', metadata: { internal: isInternal }, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: isInternal ? 'Compte marqué interne (accès illimité)' : 'Compte interne désactivé' })
      }

      case 'edit_shop': {
        const updates: Record<string, any> = {}
        if (name !== undefined)     updates.name     = name
        if (city !== undefined)     updates.city     = city
        if (country !== undefined)  updates.country  = country
        if (whatsapp !== undefined) updates.whatsapp = whatsapp
        // Devise (V3) : toujours un code ISO. Normalise ce qui est fourni,
        // sinon dérive du pays si le pays change. Le super_admin peut
        // changer la devise même avec un historique (garde manuelle).
        if (currency !== undefined) {
          const iso = normalizeCurrency(currency, country)
          if (!iso) return NextResponse.json({ error: `Devise non reconnue : ${currency}` }, { status: 400 })
          updates.currency = iso
        } else if (country !== undefined) {
          updates.currency = currencyCodeForCountry(country)
        }
        if (Object.keys(updates).length === 0) {
          return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
        }
        await admin.from('shops').update(updates).eq('id', shop_id)
        await writeAuditLog({ action: 'admin.edit_shop', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', metadata: updates, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: 'Boutique mise à jour' })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
