import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// GET /api/stock/movements?shop_ids=id1,id2&type=in&from=2026-01-01&to=2026-12-31
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shopIdsParam = searchParams.get('shop_ids')
    if (!shopIdsParam) return NextResponse.json({ error: 'shop_ids requis' }, { status: 400 })
    const shopIds = shopIdsParam.split(',').map(s => s.trim()).filter(Boolean)

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Verify shop access
    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', session.user.id).eq('is_active', true)
    const allowedIds = (members || []).map((m: any) => m.shop_id)
    if (!allowedIds.length) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient() as any

    let query = admin
      .from('stock_movements')
      .select('id, type, quantity, reason, notes, created_at, product_id, performed_by, shop_id')
      .in('shop_id', allowedIds)
      .order('created_at', { ascending: false })
      .limit(500)

    const typeFilter = searchParams.get('type')
    if (typeFilter) query = query.eq('type', typeFilter)

    const from = searchParams.get('from')
    const to   = searchParams.get('to')
    if (from) query = query.gte('created_at', `${from}T00:00:00`)
    if (to)   query = query.lte('created_at', `${to}T23:59:59`)

    const { data: rows, error } = await query
    if (error) throw error

    // Enrich with product names and performer names
    const productIds  = Array.from(new Set((rows || []).map((r: any) => r.product_id).filter(Boolean)))
    const performerIds = Array.from(new Set((rows || []).map((r: any) => r.performed_by).filter(Boolean)))

    const [productsRes, profilesRes] = await Promise.all([
      productIds.length
        ? admin.from('products').select('id, name, unit').in('id', productIds)
        : Promise.resolve({ data: [] }),
      performerIds.length
        ? admin.from('profiles').select('id, full_name').in('id', performerIds)
        : Promise.resolve({ data: [] }),
    ])

    const productMap: Record<string, { name: string; unit: string }> = {}
    for (const p of (productsRes.data || [])) productMap[p.id] = p

    const profileMap: Record<string, string> = {}
    for (const p of (profilesRes.data || [])) profileMap[p.id] = p.full_name

    const movements = (rows || []).map((r: any) => ({
      id: r.id,
      type: r.type,
      quantity: r.quantity,
      reason: r.reason,
      notes: r.notes,
      created_at: r.created_at,
      product_name: productMap[r.product_id]?.name || null,
      product_unit: productMap[r.product_id]?.unit || null,
      performed_by_name: r.performed_by ? (profileMap[r.performed_by] || null) : null,
    }))

    return NextResponse.json({ movements })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
