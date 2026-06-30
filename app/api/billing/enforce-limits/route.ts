import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { enforceOwnerPlanLimits } from '@/lib/saas/enforce-limits'

// Called from the billing page / app-layout when the owner loads the app
// after a plan change or expiry — enforces limits and returns what changed.
export async function POST() {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Only owners can trigger enforcement
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!['owner', 'super_admin'].includes((profile as any)?.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const result = await enforceOwnerPlanLimits(admin, user.id)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
