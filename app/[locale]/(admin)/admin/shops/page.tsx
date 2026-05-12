import { createAdminClient } from '@/lib/supabase/server'
import { ShopsViewToggle } from '@/components/admin/shops-view-toggle'

export default async function AdminShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = createAdminClient()

  const [{ data: shops }, { data: subs }, { data: profiles }] = await Promise.all([
    supabase.from('shops').select('id, name, city, country, currency, plan, trial_ends_at, plan_expires_at, created_at, whatsapp, owner_id').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, paystack_reference, starts_at, expires_at, created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, full_name, shop_id, role, is_active, last_seen').eq('role', 'owner'),
  ])

  // Owner profiles keyed by profile.id (= auth.users.id = shops.owner_id)
  const profileById: Record<string, any> = {}
  for (const p of profiles || []) profileById[p.id] = p

  // Owner profiles keyed by their main shop_id (for the shops table)
  const ownersByShop: Record<string, any> = {}
  for (const p of profiles || []) if (p.shop_id) ownersByShop[p.shop_id] = p

  const subsByShop: Record<string, any[]> = {}
  for (const s of subs || []) {
    if (!subsByShop[s.shop_id]) subsByShop[s.shop_id] = []
    subsByShop[s.shop_id].push(s)
  }

  // Enrich shops for the flat table view
  const enrichedShops = (shops || []).map((shop: any) => ({
    ...shop,
    owner: ownersByShop[shop.id] || profileById[shop.owner_id] || null,
    subscriptions: subsByShop[shop.id] || [],
  }))

  // Build owners list for the grouped view
  // Group shops by owner_id
  const shopsByOwner: Record<string, any[]> = {}
  for (const shop of shops || []) {
    const key = shop.owner_id || '__no_owner__'
    if (!shopsByOwner[key]) shopsByOwner[key] = []
    shopsByOwner[key].push(shop)
  }

  // For each owner, fetch their email via auth admin API
  const ownersList = Object.entries(shopsByOwner).map(([ownerId, ownerShops]) => {
    const profile = profileById[ownerId] || null
    return {
      id: ownerId,
      full_name: profile?.full_name || null,
      email: null as string | null, // fetched below
      last_seen: profile?.last_seen || null,
      shops: ownerShops,
    }
  }).sort((a, b) => b.shops.length - a.shops.length)

  // Fetch emails for each owner from auth.users via admin API
  await Promise.all(
    ownersList.map(async (owner) => {
      if (owner.id === '__no_owner__') return
      try {
        const { data } = await supabase.auth.admin.getUserById(owner.id)
        owner.email = data.user?.email || null
      } catch {}
    })
  )

  return (
    <div className="space-y-4 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Boutiques</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {(shops || []).length} boutiques · {ownersList.filter(o => o.id !== '__no_owner__').length} propriétaires · tous pays
        </p>
      </div>
      <ShopsViewToggle shops={enrichedShops} owners={ownersList} locale={locale} />
    </div>
  )
}
