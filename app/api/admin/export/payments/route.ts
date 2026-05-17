import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'

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

  const headers = ['Date', 'Boutique', 'Ville', 'Pays', 'Devise', 'Plan', 'Montant', 'Statut', 'Référence Paystack', 'Début', 'Expiration']
  const csvRows = rows.map((p: any) => {
    const shop = shopMap[p.shop_id] || {}
    const fmt = (d: string) => d ? new Date(d).toLocaleDateString('fr-FR') : ''
    return [
      fmt(p.created_at),
      `"${(shop.name || '').replace(/"/g, '""')}"`,
      `"${(shop.city || '').replace(/"/g, '""')}"`,
      shop.country || 'NG',
      shop.currency || '₦',
      p.plan || '',
      p.amount || 0,
      p.status || '',
      p.paystack_reference || '',
      fmt(p.starts_at),
      fmt(p.expires_at),
    ].join(',')
  })

  const csv = [headers.join(','), ...csvRows].join('\n')
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="paiements_${date}.csv"`,
    },
  })
}
