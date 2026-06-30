import { createAdminClient } from '@/lib/supabase/server'
import { ShopsViewToggle } from '@/components/admin/shops-view-toggle'
import { DeletedShopsPanel } from '@/components/admin/deleted-shops-panel'
import { CreateOwnerModal } from '@/components/admin/create-owner-modal'

export const dynamic = 'force-dynamic'

export default async function AdminShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = createAdminClient() as any

  const [{ data: shops }, { data: deletedShops }, { data: subs }, { data: profiles }] = await Promise.all([
    supabase.from('shops').select('id, name, city, country, currency, plan, trial_ends_at, plan_expires_at, created_at, whatsapp, owner_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('shops').select('id, name, city, country, owner_id, deleted_at, created_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
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

  // Enrich active shops for the flat table view
  const enrichedShops = (shops || []).map((shop: any) => ({
    ...shop,
    owner: ownersByShop[shop.id] || profileById[shop.owner_id] || null,
    subscriptions: subsByShop[shop.id] || [],
  }))

  // Build owners list for the grouped view
  const shopsByOwner: Record<string, any[]> = {}
  for (const shop of shops || []) {
    const key = shop.owner_id || '__no_owner__'
    if (!shopsByOwner[key]) shopsByOwner[key] = []
    shopsByOwner[key].push(shop)
  }

  const ownersList = Object.entries(shopsByOwner).map(([ownerId, ownerShops]) => {
    const profile = profileById[ownerId] || null
    return {
      id: ownerId,
      full_name: profile?.full_name || null,
      email: null as string | null,
      last_seen: profile?.last_seen || null,
      shops: ownerShops,
    }
  }).sort((a, b) => b.shops.length - a.shops.length)

  // Fetch emails for all owners + deleted shop owners
  const deletedOwnerIds = (deletedShops || [])
    .map((s: any) => s.owner_id)
    .filter((id: any) => id && !profileById[id])

  await Promise.all([
    ...ownersList.map(async (owner) => {
      if (owner.id === '__no_owner__') return
      try {
        const { data } = await supabase.auth.admin.getUserById(owner.id)
        owner.email = data.user?.email || null
      } catch {}
    }),
  ])

  // Enrich deleted shops with owner info
  const emailByOwner: Record<string, string | null> = {}
  await Promise.all(
    Array.from(new Set(deletedOwnerIds)).map(async (ownerId: any) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(ownerId)
        emailByOwner[ownerId] = data.user?.email || null
      } catch {}
    })
  )

  const enrichedDeletedShops = (deletedShops || []).map((shop: any) => ({
    ...shop,
    ownerName: profileById[shop.owner_id]?.full_name || null,
    ownerEmail: ownersList.find(o => o.id === shop.owner_id)?.email || emailByOwner[shop.owner_id] || null,
  }))

  return (
    <div className="space-y-4 max-w-7xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Boutiques</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {(shops || []).length} boutiques · {ownersList.filter(o => o.id !== '__no_owner__').length} propriétaires · tous pays
            {enrichedDeletedShops.length > 0 && (
              <span className="ml-2 text-red-400">· {enrichedDeletedShops.length} supprimée{enrichedDeletedShops.length > 1 ? 's' : ''}</span>
            )}
          </p>
        </div>
        <CreateOwnerModal />
      </div>

      {enrichedDeletedShops.length > 0 && (
        <DeletedShopsPanel shops={enrichedDeletedShops} />
      )}

      <ShopsViewToggle shops={enrichedShops} owners={ownersList} locale={locale} />
    </div>
  )
}
