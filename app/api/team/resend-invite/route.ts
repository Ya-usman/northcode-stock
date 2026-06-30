import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { validateBody, uuid, email as emailSchema } from '@/lib/api/validate'
import { z } from 'zod'

const schema = z.object({
  email: emailSchema,
  shop_id: uuid,
})

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const body = await request.json()
    const validated = validateBody(schema, body)
    if ('error' in validated) return validated.error
    const { email, shop_id } = validated.data

    // Only owners/managers can resend invitations
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .single()

    if (!callerMember || !['owner', 'manager', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = getAdminClient()
    const locale = (request.headers.get('cookie') ?? '').match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'

    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/${locale}/reset-password`,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
