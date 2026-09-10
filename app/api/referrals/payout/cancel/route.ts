import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// POST /api/referrals/payout/cancel — le commerçant annule SA PROPRE
// demande de retrait tant qu'elle n'est pas payée. Les fonds réservés
// reviennent dans son solde disponible (géré par resolve_referral_payout).
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }

    const { request_id } = await request.json()
    if (!request_id) return NextResponse.json({ error: 'request_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any

    // La demande doit appartenir à ce commerçant et être encore annulable.
    const { data: req } = await admin
      .from('referral_payout_requests').select('id, user_id, status').eq('id', request_id).maybeSingle()
    if (!req || req.user_id !== user.id) {
      return NextResponse.json({ error: 'Demande introuvable' }, { status: 404 })
    }
    if (!['requested', 'under_review'].includes(req.status)) {
      return NextResponse.json({ error: 'Cette demande ne peut plus être annulée' }, { status: 400 })
    }

    const { data, error } = await admin.rpc('resolve_referral_payout', {
      p_request_id: request_id,
      p_new_status: 'cancelled',
      p_reviewer_id: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.ok) return NextResponse.json({ error: data?.reason || 'Annulation impossible' }, { status: 400 })

    await writeAuditLog({
      action: 'referral.payout_cancelled',
      actor_id: user.id,
      target_id: request_id,
      target_type: 'referral_payout_request',
      metadata: { by: 'owner' },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
