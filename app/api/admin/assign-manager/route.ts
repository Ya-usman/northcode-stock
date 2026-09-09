import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error

    const { email, shop_id, role = 'owner' } = await request.json()
    if (!email || !shop_id) return NextResponse.json({ error: 'email et shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any

    // Find user by email
    const { data: { users }, error: listError } = await admin.auth.admin.listUsers()
    if (listError) throw listError

    const targetUser = users.find((u: any) => u.email === email)
    if (!targetUser) return NextResponse.json({ error: `Aucun compte trouvé pour ${email}` }, { status: 404 })

    // Upsert into shop_members
    const { error: memberError } = await admin.from('shop_members').upsert({
      shop_id,
      user_id: targetUser.id,
      role,
      is_active: true,
    } as any, { onConflict: 'shop_id,user_id' })

    if (memberError) throw memberError

    // Also update profiles.shop_id if not set
    await admin.from('profiles').update({ shop_id, role } as any)
      .eq('id', targetUser.id)
      .is('shop_id', null)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE /api/admin/assign-manager — révoquer l'accès d'un member (super_admin)
export async function DELETE(request: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error

    const { member_id } = await request.json()
    if (!member_id) return NextResponse.json({ error: 'member_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { error } = await admin.from('shop_members').update({ is_active: false }).eq('id', member_id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
