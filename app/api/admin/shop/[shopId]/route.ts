import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

// GET /api/admin/shop/[shopId] — données complètes pour le Shop Inspector
export async function GET(_req: Request, { params }: { params: { shopId: string } }) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || ''))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

    const admin = await createAdminClient() as any
    const { shopId } = params

    const [
      { data: shop },
      { data: owner },
      { data: members },
      { data: products },
      { data: customers },
      { data: sales },
      { data: subs },
      { data: deletedLog },
      { count: archivedCount },
      { count: deletedCustCount },
    ] = await Promise.all([
      admin.from('shops').select('*').eq('id', shopId).single(),
      admin.from('profiles').select('id, full_name, email:id, is_active, last_seen').eq('shop_id', shopId).eq('role', 'owner').maybeSingle(),
      admin.from('shop_members').select('user_id, role, is_active, profiles(full_name, last_seen)').eq('shop_id', shopId),
      admin.from('products').select('id', { count: 'exact', head: false }).eq('shop_id', shopId).eq('is_active', true),
      admin.from('customers').select('id', { count: 'exact', head: false }).eq('shop_id', shopId).is('deleted_at', null),
      admin.from('sales').select('id, total_amount, created_at').eq('shop_id', shopId).eq('sale_status', 'active').order('created_at', { ascending: false }).limit(30),
      admin.from('subscriptions').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
      admin.from('deleted_records_log').select('id, table_name, deleted_at').eq('shop_id', shopId).order('deleted_at', { ascending: false }).limit(20),
      admin.from('products').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).eq('is_active', false),
      admin.from('customers').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).not('deleted_at', 'is', null),
    ])

    // Owner email via auth.users (service role)
    let ownerEmail = null
    if (owner?.id) {
      const { data: authUser } = await admin.auth.admin.getUserById(owner.id)
      ownerEmail = authUser?.user?.email || null
    }

    // Ventes today et 7 derniers jours
    const now = new Date()
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const start7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const salesArr = sales || []
    const salesToday = salesArr.filter((s: any) => s.created_at >= startToday)
    const sales7d = salesArr.filter((s: any) => s.created_at >= start7d)

    const totalSalesAmount = salesArr.reduce((acc: number, s: any) => acc + Number(s.total_amount || 0), 0)
    const salesTodayAmount = salesToday.reduce((acc: number, s: any) => acc + Number(s.total_amount || 0), 0)

    // Score de santé (0-100)
    const lastSeenDate = owner?.last_seen ? new Date(owner.last_seen) : null
    const daysSinceLastSeen = lastSeenDate ? Math.floor((Date.now() - lastSeenDate.getTime()) / 86400000) : 999
    const health = Math.min(100,
      (daysSinceLastSeen <= 7 ? 20 : 0) +
      (sales7d.length > 0 ? 20 : 0) +
      ((products?.length ?? 0) >= 5 ? 20 : 0) +
      ((customers?.length ?? 0) >= 1 ? 20 : 0) +
      (subs?.some((s: any) => s.status === 'active') ? 10 : 0) +
      ((members?.filter((m: any) => m.is_active).length ?? 0) > 1 ? 10 : 0)
    )

    return NextResponse.json({
      shop,
      owner: owner ? { ...owner, email: ownerEmail } : null,
      members: members || [],
      stats: {
        productsActive: products?.length ?? 0,
        productsArchived: archivedCount ?? 0,
        customersActive: customers?.length ?? 0,
        customersDeleted: deletedCustCount ?? 0,
        totalSales: salesArr.length,
        totalSalesAmount,
        salesToday: salesToday.length,
        salesTodayAmount,
        sales7d: sales7d.length,
        deletedLogCount: deletedLog?.length ?? 0,
      },
      subscriptions: subs || [],
      health,
      daysSinceLastSeen: daysSinceLastSeen === 999 ? null : daysSinceLastSeen,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
