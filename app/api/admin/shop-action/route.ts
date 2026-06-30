import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export async function POST(request: Request) {
  try {
    // Auth check — email allowlist OR super_admin DB role required
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const emailAllowed = SUPER_ADMIN_EMAILS.length > 0 && SUPER_ADMIN_EMAILS.includes(user.email || '')
    if (!emailAllowed) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (profile?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }
    }

    const body = await request.json()
    const { action, shop_id, days, name, city, country, whatsapp, currency } = body
    if (!action || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Get owner_id for profile-level updates
    const { data: targetShop } = await admin.from('shops').select('owner_id').eq('id', shop_id).single()
    const owner_id = (targetShop as any)?.owner_id

    switch (action) {
      case 'suspend': {
        const expiredAt = new Date(Date.now() - 1000).toISOString()
        // Deactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: false }).eq('shop_id', shop_id)
        // Expire the plan on all owner shops + owner profile
        await admin.from('shops').update({
          plan_expires_at: expiredAt,
          trial_ends_at: expiredAt,
        } as any).eq('id', shop_id)
        if (owner_id) {
          await admin.from('profiles').update({
            plan_expires_at: expiredAt,
            trial_ends_at: expiredAt,
          } as any).eq('id', owner_id)
        }
        await writeAuditLog({ action: 'admin.suspend_shop', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: 'Shop suspended' })
      }

      case 'reactivate': {
        const newTrial = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        // Reactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: true }).eq('shop_id', shop_id)
        await admin.from('shops').update({
          trial_ends_at: newTrial,
          plan: 'trial',
          plan_expires_at: null,
        } as any).eq('id', shop_id)
        if (owner_id) {
          await admin.from('profiles').update({
            plan: 'trial',
            plan_expires_at: null,
            trial_ends_at: newTrial,
          } as any).eq('id', owner_id)
        }
        await writeAuditLog({ action: 'admin.reactivate_shop', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: 'Shop reactivated' })
      }

      case 'extend': {
        const daysToAdd = Number(days) || 30
        // Read plan from owner profile if available, fallback to shop
        let planSource: any = null
        if (owner_id) {
          const { data: ownerProfile } = await admin.from('profiles').select('plan, plan_expires_at, trial_ends_at').eq('id', owner_id).single()
          planSource = ownerProfile
        }
        if (!planSource) {
          const { data: shop } = await admin.from('shops').select('plan, plan_expires_at, trial_ends_at').eq('id', shop_id).single()
          planSource = shop
        }
        const hasActivePlan = planSource?.plan && planSource.plan !== 'trial' && planSource?.plan_expires_at && new Date(planSource.plan_expires_at) > new Date()

        if (hasActivePlan) {
          const current = new Date(planSource.plan_expires_at)
          current.setDate(current.getDate() + daysToAdd)
          const newExpiry = current.toISOString()
          await admin.from('shops').update({ plan_expires_at: newExpiry } as any).eq('id', shop_id)
          if (owner_id) await admin.from('profiles').update({ plan_expires_at: newExpiry } as any).eq('id', owner_id)
        } else {
          const current = planSource?.trial_ends_at ? new Date(planSource.trial_ends_at) : new Date()
          if (current < new Date()) current.setTime(Date.now())
          current.setDate(current.getDate() + daysToAdd)
          const newTrial = current.toISOString()
          await admin.from('shops').update({ trial_ends_at: newTrial } as any).eq('id', shop_id)
          if (owner_id) await admin.from('profiles').update({ trial_ends_at: newTrial } as any).eq('id', owner_id)
        }
        await writeAuditLog({ action: 'admin.extend_access', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', metadata: { days: daysToAdd }, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: `Extended by ${daysToAdd} days` })
      }

      case 'grant_plan': {
        const planId = days // reuse 'days' param for plan id
        const expires = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()
        await admin.from('shops').update({
          plan: planId,
          plan_expires_at: expires,
        } as any).eq('id', shop_id)
        await admin.from('profiles').update({ is_active: true }).eq('shop_id', shop_id)
        if (owner_id) {
          await admin.from('profiles').update({
            plan: planId,
            plan_expires_at: expires,
            trial_ends_at: null,
          } as any).eq('id', owner_id)
          // Sync all owner's active shops
          await admin.from('shops').update({
            plan: planId,
            plan_expires_at: expires,
          } as any).eq('owner_id', owner_id).is('deleted_at', null)
        }
        await writeAuditLog({ action: 'admin.grant_plan', shop_id, actor_id: user.id, actor_email: user.email, target_id: shop_id, target_type: 'shop', metadata: { plan: planId }, ip: getClientIp(request) })
        return NextResponse.json({ success: true, message: `Plan ${planId} granted` })
      }

      case 'edit_shop': {
        const updates: Record<string, any> = {}
        if (name !== undefined)     updates.name     = name
        if (city !== undefined)     updates.city     = city
        if (country !== undefined)  updates.country  = country
        if (whatsapp !== undefined) updates.whatsapp = whatsapp
        if (currency !== undefined) updates.currency = currency
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
