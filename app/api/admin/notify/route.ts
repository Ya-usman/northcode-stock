import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

// POST /api/admin/notify — envoyer une notification in-app à un owner
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || ''))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { shop_id, type, title, message } = await req.json()
    if (!shop_id || !title?.trim() || !message?.trim())
      return NextResponse.json({ error: 'shop_id, title et message requis' }, { status: 400 })
    if (!['info', 'warning', 'urgent'].includes(type || 'info'))
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('admin_notifications')
      .insert({ shop_id, type: type || 'info', title: title.trim(), message: message.trim() })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// GET /api/admin/notify?shop_id=xxx — lister les notifications d'une boutique
export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || ''))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const shop_id = searchParams.get('shop_id')
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('admin_notifications')
      .select('*')
      .eq('shop_id', shop_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/admin/notify?id=xxx — supprimer une notification
export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || ''))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { error } = await admin.from('admin_notifications').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
