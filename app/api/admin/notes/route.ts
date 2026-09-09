import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

// GET /api/admin/notes?shop_id=xxx
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

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
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  const { shop_id, content } = await req.json()
  if (!shop_id || !content?.trim()) return NextResponse.json({ error: 'shop_id et content requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { data, error } = await admin
    .from('shop_notes')
    .insert({ shop_id, content: content.trim(), author_email: user.email })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

// DELETE /api/admin/notes?id=xxx
export async function DELETE(req: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { error } = await admin.from('shop_notes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
