import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// GET /api/referral/validate?code=XXX — vérifie un code de parrainage,
// agent de terrain (existant, migration 052) OU parrainage utilisateur
// (migration 127). Même route pour les deux : les deux systèmes partagent
// le même espace de codes (voir lib/referrals/generate-code.ts), donc un
// code donné ne peut désigner que l'un ou l'autre, jamais les deux.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')?.trim().toUpperCase()
  if (!code) return NextResponse.json({ valid: false, error: 'missing_code' }, { status: 400 })

  try {
    const supabase = await createAdminClient() as any

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name, referral_code')
      .eq('referral_code', code)
      .eq('is_active', true)
      .maybeSingle()
    if (agentError) throw agentError

    if (agent) {
      return NextResponse.json({ valid: true, kind: 'agent', agent: { id: agent.id, name: agent.name, code: agent.referral_code } })
    }

    const { data: referral, error: referralError } = await supabase
      .from('referral_codes')
      .select('id, code, owner_user_id, active')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle()
    if (referralError) throw referralError

    if (referral) {
      // Pas de FK directe referral_codes -> profiles (toutes deux référencent
      // auth.users indépendamment) — requête séparée, pas d'embed PostgREST.
      const { data: referrerProfile } = await supabase
        .from('profiles').select('full_name').eq('id', referral.owner_user_id).maybeSingle()
      return NextResponse.json({
        valid: true,
        kind: 'referrer',
        referrer: { id: referral.owner_user_id, name: referrerProfile?.full_name || null, code: referral.code },
      })
    }

    return NextResponse.json({ valid: false })
  } catch (err: any) {
    return NextResponse.json({ valid: false, error: err.message }, { status: 500 })
  }
}
