import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

async function checkSuperAdmin() {
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  if (!SUPER_ADMIN_EMAILS.includes(user.email ?? '')) return null
  return user
}

// GET /api/admin/agents/commissions?agent_id=xxx&status=pending
export async function GET(request: NextRequest) {
  const user = await checkSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const agent_id = request.nextUrl.searchParams.get('agent_id')
  const status = request.nextUrl.searchParams.get('status')

  const supabase = await createAdminClient() as any
  let query = supabase
    .from('agent_commissions')
    .select(`
      *,
      agent:agents(name, referral_code),
      shop:shops(name, city)
    `)
    .order('created_at', { ascending: false })

  if (agent_id) query = query.eq('agent_id', agent_id)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ commissions: data })
}

// PATCH /api/admin/agents/commissions — marquer commissions comme payées
export async function PATCH(request: NextRequest) {
  const user = await checkSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = await request.json()
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }

  const supabase = await createAdminClient() as any
  const { error } = await supabase
    .from('agent_commissions')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, updated: ids.length })
}
