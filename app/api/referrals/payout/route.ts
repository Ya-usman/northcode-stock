import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getOrCreateWallet } from '@/lib/referrals/wallet'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

const REASON_MESSAGES: Record<string, string> = {
  disabled: 'Le programme de parrainage n\'est pas actif actuellement',
  no_wallet: 'Aucun portefeuille de parrainage',
  frozen: 'Portefeuille gelé — contactez le support',
  request_already_open: 'Vous avez déjà une demande de retrait en cours',
  below_minimum: 'Montant inférieur au minimum de retrait',
  insufficient_balance: 'Solde disponible insuffisant',
}

// POST /api/referrals/payout — le commerçant demande un retrait de ses gains.
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if ((profile as any)?.role !== 'owner') {
      return NextResponse.json({ error: 'Réservé aux propriétaires de boutique' }, { status: 403 })
    }

    const body = await request.json()
    const amount = Number(body?.amount)
    const method = String(body?.method || '').slice(0, 40)
    const paymentDetails = typeof body?.payment_details === 'string'
      ? { note: body.payment_details.slice(0, 500) }
      : (body?.payment_details && typeof body.payment_details === 'object' ? body.payment_details : {})

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 })
    }
    if (!method) {
      return NextResponse.json({ error: 'Méthode de retrait requise' }, { status: 400 })
    }

    const admin = await createAdminClient() as any
    await getOrCreateWallet(admin, user.id) // s'assure qu'un portefeuille existe

    const { data, error } = await admin.rpc('request_referral_payout', {
      p_user_id: user.id,
      p_amount: amount,
      p_method: method,
      p_payment_details: paymentDetails,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (!data?.ok) {
      const msg = REASON_MESSAGES[data?.reason] || 'Demande de retrait impossible'
      return NextResponse.json({ error: msg, reason: data?.reason, minimum: data?.minimum ?? null }, { status: 400 })
    }

    await writeAuditLog({
      action: 'referral.payout_requested',
      actor_id: user.id,
      target_id: data.request_id,
      target_type: 'referral_payout_request',
      metadata: { amount: data.amount, currency: data.currency, method },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, request_id: data.request_id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
