import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { attachOwnerPlan } from '@/lib/saas/resolve-owner-plan'
import { requireAdmin } from '@/lib/api/require-admin'
import { getCountry, getBillingCurrency } from '@/lib/saas/countries'

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = createAdminClient() as any

  const [{ data: shops }, { data: profiles }, { data: subs }] = await Promise.all([
    admin.from('shops').select('id, name, city, country, currency, billing_country, created_at, whatsapp, owner_id').is('deleted_at', null).order('created_at', { ascending: false }),
    admin.from('profiles').select('id, full_name, shop_id, is_active, last_seen').eq('role', 'owner'),
    admin.from('subscriptions').select('shop_id, amount').eq('status', 'active'),
  ])

  // Plan/trial are owner-level (profiles), not columns on shops anymore.
  await attachOwnerPlan(admin, shops || [])

  const ownersByShop: Record<string, any> = {}
  for (const p of profiles || []) if (p.shop_id) ownersByShop[p.shop_id] = p

  const revenueByShop: Record<string, number> = {}
  for (const s of subs || []) revenueByShop[s.shop_id] = (revenueByShop[s.shop_id] || 0) + Number(s.amount)

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : ''
  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Nom', 'Ville', 'Pays', 'Devise (facturation)', 'Plan', 'Statut', 'Trial expire', 'Plan expire', 'Revenue total', 'Propriétaire', 'Dernière connexion', 'WhatsApp', 'Créée le']
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
      // Devise de FACTURATION — c'est ce qui décrit "Revenue total"
      // ci-dessous (un montant d'abonnement), pas la devise métier (s.currency).
      q(getBillingCurrency(getCountry(s.billing_country || s.country))),
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
