import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

async function authAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || '')) return { user: null, email: null }
  return { user, email: user.email! }
}

// GET /api/admin/notes?shop_id=xxx
export async function GET(req: Request) {
  const { user } = await authAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const shop_id = searchParams.get('shop_id')
  if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { data, error } = await admin
    .from('shop_notes')
    .select('*')
    .eq('shop_id', shop_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// POST /api/admin/notes — créer une note
export async function POST(req: Request) {
  const { user, email } = await authAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { shop_id, content } = await req.json()
  if (!shop_id || !content?.trim()) return NextResponse.json({ error: 'shop_id et content requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { data, error } = await admin
    .from('shop_notes')
    .insert({ shop_id, content: content.trim(), author_email: email })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// DELETE /api/admin/notes?id=xxx
export async function DELETE(req: Request) {
  const { user } = await authAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { error } = await admin.from('shop_notes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
