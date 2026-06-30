import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Returns email_confirmed_at and last_sign_in_at for a list of user IDs
// Only accessible by owners/managers/super_admin
export async function POST(request: Request) {
  try {
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { user_ids, shop_id } = await request.json()
    if (!Array.isArray(user_ids) || !shop_id) {
      return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 })
    }

    // Verify caller is owner/manager of this shop
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .single()

    if (!callerMember || !['owner', 'manager', 'shop_manager', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = getAdminClient()

    // Fetch auth status for each member in parallel
    const results = await Promise.allSettled(
      user_ids.map((id: string) => admin.auth.admin.getUserById(id))
    )

    const statusMap: Record<string, { email_confirmed_at: string | null; last_sign_in_at: string | null }> = {}
    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.data.user) {
        const u = result.value.data.user
        statusMap[user_ids[i]] = {
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        }
      }
    })

    return NextResponse.json({ status: statusMap })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
