import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { notifyReferral, formatRefAmount } from '@/lib/referrals/notify'

// GET /api/admin/referrals/payouts — liste des demandes de retrait.
// Lecture ouverte aux deux niveaux admin (comme le reste de /api/admin en lecture).
export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')

  let query = admin
    .from('referral_payout_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (status && status !== 'all') query = query.eq('status', status)

  const { data: requests, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Emails des demandeurs (via auth.users, comme ailleurs dans l'admin)
  const userIds = Array.from(new Set((requests || []).map((r: any) => r.user_id)))
  const emailById: Record<string, string | null> = {}
  await Promise.all(userIds.map(async (id: any) => {
    try {
      const { data } = await admin.auth.admin.getUserById(id)
      emailById[id] = data.user?.email || null
    } catch { emailById[id] = null }
  }))

  const enriched = (requests || []).map((r: any) => ({ ...r, user_email: emailById[r.user_id] || null }))
  return NextResponse.json({ requests: enriched })
}

// POST /api/admin/referrals/payouts — résout une demande (super_admin uniquement).
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  try {
    const { request_id, status } = await request.json()
    if (!request_id || !status) {
      return NextResponse.json({ error: 'request_id et status requis' }, { status: 400 })
    }
    if (!['under_review', 'approved', 'paid', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
    }

    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('resolve_referral_payout', {
      p_request_id: request_id,
      p_new_status: status,
      p_reviewer_id: user.id,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data?.ok) return NextResponse.json({ error: data?.reason || 'Action impossible' }, { status: 400 })

    await writeAuditLog({
      action: 'referral.payout_resolved',
      actor_id: user.id,
      actor_email: user.email,
      target_id: request_id,
      target_type: 'referral_payout_request',
      metadata: { status },
      ip: getClientIp(request),
    })

    // Notifier le demandeur quand sa demande avance (approuvée / payée).
    if (status === 'approved' || status === 'paid') {
      const { data: req } = await admin
        .from('referral_payout_requests').select('user_id, amount, currency').eq('id', request_id).maybeSingle()
      if (req?.user_id) {
        await notifyReferral(admin, {
          userId: req.user_id,
          event: status === 'paid' ? 'payout_paid' : 'payout_approved',
          vars: { amount: formatRefAmount(req.amount, req.currency) },
        })
      }
    }

    return NextResponse.json({ success: true, status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
