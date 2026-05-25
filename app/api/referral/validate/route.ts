import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim().toUpperCase()
  if (!code) return NextResponse.json({ valid: false, error: 'missing_code' }, { status: 400 })

  try {
    const supabase = await createAdminClient() as any
    const { data, error } = await supabase
      .from('agents')
      .select('id, name, referral_code')
      .eq('referral_code', code)
      .eq('is_active', true)
      .maybeSingle()

    if (error) throw error
    if (!data) return NextResponse.json({ valid: false })

    return NextResponse.json({ valid: true, agent: { id: data.id, name: data.name, code: data.referral_code } })
  } catch (err: any) {
    return NextResponse.json({ valid: false, error: err.message }, { status: 500 })
  }
}
