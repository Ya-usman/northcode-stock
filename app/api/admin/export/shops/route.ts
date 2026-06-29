import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export async function GET(request: Request) {
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  const emailAllowed = SUPER_ADMIN_EMAILS.length > 0 && SUPER_ADMIN_EMAILS.includes(user.email || '')
  if (!emailAllowed) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'super_admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const admin = createAdminClient() as any

  const [{ data: shops }, { data: profiles }, { data: subs }] = await Promise.all([
    admin.from('shops').select('id, name, city, country, currency, plan, trial_ends_at, plan_expires_at, created_at, whatsapp, owner_id').is('deleted_at', null).order('created_at', { ascending: false }),
    admin.from('profiles').select('id, full_name, shop_id, is_active, last_seen').eq('role', 'owner'),
    admin.from('subscriptions').select('shop_id, amount').eq('status', 'active'),
  ])

  const ownersByShop: Record<string, any> = {}
  for (const p of profiles || []) if (p.shop_id) ownersByShop[p.shop_id] = p

  const revenueByShop: Record<string, number> = {}
  for (const s of subs || []) revenueByShop[s.shop_id] = (revenueByShop[s.shop_id] || 0) + Number(s.amount)

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : ''
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Nom', 'Ville', 'Pays', 'Devise', 'Plan', 'Statut', 'Trial expire', 'Plan expire', 'Revenue total', 'Propriétaire', 'Dernière connexion', 'WhatsApp', 'Créée le']
  const rows = (shops || []).map((s: any) => {
    const owner = ownersByShop[s.id]
    const subscribed = hasActiveSubscription(s.plan, s.plan_expires_at)
    const trialDays = getTrialDaysLeft(s.trial_ends_at)
    const isSuspended = owner?.is_active === false
    const status = isSuspended ? 'Suspendu' : subscribed ? 'Payant' : trialDays >= 0 ? 'Trial' : 'Expiré'
    return [
      q(s.name || ''),
      q(s.city || ''),
      q(s.country || 'NG'),
      q(s.currency || '₦'),
      q(s.plan || ''),
      q(status),
      q(fmt(s.trial_ends_at)),
      q(fmt(s.plan_expires_at)),
      q(revenueByShop[s.id] || 0),
      q(owner?.full_name || ''),
      q(fmt(owner?.last_seen)),
      q(s.whatsapp || ''),
      q(fmt(s.created_at)),
    ].join(',')
  })

  const csv = '﻿' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\n')
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="boutiques_${date}.csv"`,
    },
  })
}
