import { createClient } from '@/lib/supabase/server'
import { AdminShopsTable } from '@/components/admin/shops-table'

export default async function AdminShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()

  const [{ data: shops }, { data: subs }, { data: owners }] = await Promise.all([
    supabase.from('shops').select('id, name, city, plan, trial_ends_at, plan_expires_at, created_at, whatsapp, is_warehouse').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, paystack_reference, starts_at, expires_at, created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, shop_id, role, is_active, last_seen').eq('role', 'owner'),
  ])

  const ownersByShop = (owners || []).reduce((acc: any, o: any) => { acc[o.shop_id] = o; return acc }, {})
  const subsByShop = (subs || []).reduce((acc: any, s: any) => {
    if (!acc[s.shop_id]) acc[s.shop_id] = []
    acc[s.shop_id].push(s)
    return acc
  }, {})

  const enrichedShops = (shops || []).map((shop: any) => ({
    ...shop,
    owner: ownersByShop[shop.id] || null,
    subscriptions: subsByShop[shop.id] || [],
  }))

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Shops</h1>
        <p className="text-gray-400 text-sm mt-1">Manage all registered shops</p>
      </div>
      <AdminShopsTable shops={enrichedShops} locale={locale} />
    </div>
  )
}
