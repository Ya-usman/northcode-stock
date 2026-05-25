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

// GET /api/admin/agents — liste tous les agents avec stats
export async function GET(request: NextRequest) {
  const user = await checkSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createAdminClient() as any
  const { data, error } = await supabase
    .from('agents')
    .select(`
      *,
      shops:shops(count),
      commissions:agent_commissions(count)
    `)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ agents: data })
}

// POST /api/admin/agents — créer un agent
export async function POST(request: NextRequest) {
  const user = await checkSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, email, phone, city, referral_code, commission_rate = 10 } = body

  if (!name || !referral_code) {
    return NextResponse.json({ error: 'name and referral_code are required' }, { status: 400 })
  }

  const supabase = await createAdminClient() as any
  const { data, error } = await supabase
    .from('agents')
    .insert({
      name: name.trim(),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      city: city?.trim() || null,
      referral_code: referral_code.toUpperCase().trim(),
      commission_rate: Number(commission_rate),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ agent: data }, { status: 201 })
}

// PATCH /api/admin/agents — mettre à jour un agent
export async function PATCH(request: NextRequest) {
  const user = await checkSuperAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (updates.referral_code) updates.referral_code = updates.referral_code.toUpperCase().trim()

  const supabase = await createAdminClient() as any
  const { data, error } = await supabase
    .from('agents')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ agent: data })
}
