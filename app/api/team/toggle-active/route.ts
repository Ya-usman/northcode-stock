import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { employee_id, is_active, shop_id } = await request.json()

    if (!employee_id || !shop_id || typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Auth check — only owner of this shop can do this
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: caller } = await supabase
      .from('profiles')
      .select('role, shop_id')
      .eq('id', user.id)
      .single()

    if (!caller || caller.role !== 'owner' || caller.shop_id !== shop_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Cannot deactivate yourself
    if (employee_id === user.id) {
      return NextResponse.json({ error: 'Cannot deactivate your own account' }, { status: 400 })
    }

    const admin = await createAdminClient()

    // Update is_active in profiles
    const { error } = await admin
      .from('profiles')
      .update({ is_active })
      .eq('id', employee_id)
      .eq('shop_id', shop_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // If deactivating: sign out all sessions for this user immediately
    if (!is_active) {
      await admin.auth.admin.signOut(employee_id, 'global')
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
