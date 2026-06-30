import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

// GET /api/admin/agents/shops — liste minimale pour le formulaire commission
export async function GET() {
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !SUPER_ADMIN_EMAILS.includes(user.email ?? ''))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await createAdminClient() as any
  const { data, error } = await admin
    .from('shops')
    .select('id, name, city')
    .is('deleted_at', null)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ shops: data || [] })
}
