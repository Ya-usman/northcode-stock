import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

export async function POST(request: Request) {
  try {
    // Auth check
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { action, shop_id, days } = await request.json()
    if (!action || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    switch (action) {
      case 'suspend': {
        // Deactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: false }).eq('shop_id', shop_id)
        // Expire the plan immediately
        await admin.from('shops').update({
          plan_expires_at: new Date(Date.now() - 1000).toISOString(),
          trial_ends_at: new Date(Date.now() - 1000).toISOString(),
        } as any).eq('id', shop_id)
        return NextResponse.json({ success: true, message: 'Shop suspended' })
      }

      case 'reactivate': {
        // Reactivate all profiles for this shop
        await admin.from('profiles').update({ is_active: true }).eq('shop_id', shop_id)
        // Extend trial by 7 days
        await admin.from('shops').update({
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          plan: 'trial',
          plan_expires_at: null,
        } as any).eq('id', shop_id)
        return NextResponse.json({ success: true, message: 'Shop reactivated' })
      }

      case 'extend': {
        const daysToAdd = Number(days) || 7
        // Extend plan_expires_at or trial_ends_at
        const { data: shop } = await admin.from('shops').select('plan, plan_expires_at, trial_ends_at').eq('id', shop_id).single()
        const hasActivePlan = shop?.plan && shop.plan !== 'trial' && shop?.plan_expires_at && new Date(shop.plan_expires_at) > new Date()

        if (hasActivePlan) {
          const current = new Date(shop!.plan_expires_at!)
          current.setDate(current.getDate() + daysToAdd)
          await admin.from('shops').update({ plan_expires_at: current.toISOString() } as any).eq('id', shop_id)
        } else {
          const current = shop?.trial_ends_at ? new Date(shop.trial_ends_at) : new Date()
          if (current < new Date()) current.setTime(Date.now())
          current.setDate(current.getDate() + daysToAdd)
          await admin.from('shops').update({ trial_ends_at: current.toISOString() } as any).eq('id', shop_id)
        }
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
        return NextResponse.json({ success: true, message: `Plan ${planId} granted` })
      }

      case 'toggle_warehouse': {
        const { data: shop } = await admin.from('shops').select('is_warehouse').eq('id', shop_id).single()
        await admin.from('shops').update({ is_warehouse: !(shop as any)?.is_warehouse } as any).eq('id', shop_id)
        return NextResponse.json({ success: true, message: (shop as any)?.is_warehouse ? 'Entrepôt désactivé' : 'Entrepôt activé' })
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
