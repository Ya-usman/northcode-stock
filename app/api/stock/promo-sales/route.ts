import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/stock/promo-sales?shop_id&product_id&from&until
// Quantité d'un produit vendue pendant une promotion (journal du produit, components/stock/product-activity-journal).
// Lue jusqu'ici DIRECTEMENT par le navigateur (lot 2B, 26 oct. 2026) : la base ne laissait au magasinier que SES
// ventes. Ici, toute personne qui voit le Stock de la boutique obtient le même chiffre — une quantité, rien d'autre
// (comme /api/stock/sold-30d).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const sp = new URL(request.url).searchParams
    const shopId = sp.get('shop_id') || '', productId = sp.get('product_id') || ''
    const from = sp.get('from') || '', until = sp.get('until') || ''
    if (!UUID.test(shopId) || !UUID.test(productId) || [from, until].some(d => !d || Number.isNaN(Date.parse(d)))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { data: member } = await supabase.from('shop_members').select('role')
      .eq('shop_id', shopId).eq('user_id', user.id).eq('is_active', true).maybeSingle()
    if (!member || !(await canViewFeature(supabase, member.role, shopId, 'stock'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    const admin = await createAdminClient() as any
    const rows = await fetchAllRows<any>(() => admin
      .from('sale_items').select('id, quantity, sales!inner(shop_id, created_at, sale_status)')
      .eq('product_id', productId).eq('sales.shop_id', shopId).eq('sales.sale_status', 'active')
      .gte('sales.created_at', from).lte('sales.created_at', until)
      .order('id'))
    return NextResponse.json({ quantity: rows.reduce((n, r) => n + (Number(r.quantity) || 0), 0) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
