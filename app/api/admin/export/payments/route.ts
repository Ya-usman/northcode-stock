import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'

export async function GET(request: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = createAdminClient() as any
  const { searchParams } = new URL(request.url)
  const country = searchParams.get('country') || 'all'

  const [{ data: subs }, { data: shops }] = await Promise.all([
    admin.from('subscriptions').select('*').order('created_at', { ascending: false }),
    admin.from('shops').select('id, name, city, country, currency'),
  ])

  const shopMap: Record<string, any> = {}
  for (const s of shops || []) shopMap[s.id] = s

  const rows = (subs || []).filter((p: any) => {
    if (country === 'all') return true
    return (shopMap[p.shop_id]?.country || 'NG') === country
  })

  const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`

  const headers = ['Date', 'Boutique', 'Ville', 'Pays', 'Devise', 'Plan', 'Montant', 'Fournisseur', 'Renouvellement auto', 'Statut', 'Référence', 'Début', 'Expiration']
  const csvRows = rows.map((p: any) => {
    const shop = shopMap[p.shop_id] || {}
    const fmt = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : ''
    return [
      q(fmt(p.created_at)),
      q(shop.name || ''),
      q(shop.city || ''),
      q(shop.country || 'NG'),
      q(shop.currency || '₦'),
      q(p.plan || ''),
      q(p.amount || 0),
      q(p.gateway || 'paystack (historique)'),
      q(p.auto_renew ? 'Oui' : 'Non'),
      q(p.status || ''),
      q(p.paystack_reference || ''),
      q(fmt(p.starts_at)),
      q(fmt(p.expires_at)),
    ].join(',')
  })

  const csv = '﻿' + [headers.map(h => `"${h}"`).join(','), ...csvRows].join('\n')
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="paiements_${date}.csv"`,
    },
  })
}
