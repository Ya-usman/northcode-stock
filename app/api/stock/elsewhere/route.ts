import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { isManagerial } from '@/lib/permissions'
import { loadElsewhere, shareStockWithSellers, transferRequestsAvailable } from '@/lib/stock/elsewhere-load'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_PRODUCTS = 300

// GET /api/stock/elsewhere?shop_id=<boutique>&product_ids=a,b
// « Disponible ailleurs » (30 oct. 2026) : pour des produits de la boutique, leur disponible dans les AUTRES boutiques
// de la même entreprise (nom, ville, téléphone, ouverte ou fermée, quantité exacte). Lecture seule.
// Droits : membre actif de la boutique qui voit la Caisse ou le Stock. Réglage d'entreprise (190) : désactivé, seuls
// propriétaire et responsables le voient. `can_request` : peut demander un transfert (vend ou gère les transferts,
// table des demandes présente).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const url = new URL(request.url)
    const shopId = url.searchParams.get('shop_id') || ''
    const productIds = Array.from(new Set((url.searchParams.get('product_ids') || '').split(',').map(s => s.trim()).filter(s => UUID.test(s)))).slice(0, MAX_PRODUCTS)
    if (!UUID.test(shopId) || !productIds.length) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { data: member } = await supabase.from('shop_members').select('role').eq('shop_id', shopId).eq('user_id', user.id).eq('is_active', true).maybeSingle()
    const role = member?.role ?? null
    if (!role || !((await canViewFeature(supabase, role, shopId, 'new_sale')) || (await canViewFeature(supabase, role, shopId, 'stock'))))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data: shop } = await admin.from('shops').select('entity_id').eq('id', shopId).maybeSingle()
    const shared = await shareStockWithSellers(admin, shop?.entity_id ?? null)
    const privileged = role === 'owner' || role === 'super_admin' || isManagerial(role)
    if (!shared && !privileged) return NextResponse.json({ enabled: false, can_request: false, items: {} })

    const [data, requests, canSell, canTransfer] = await Promise.all([
      loadElsewhere(admin, shopId, productIds),
      transferRequestsAvailable(admin),
      canWriteFeature(supabase, role, shopId, 'new_sale'),
      canWriteFeature(supabase, role, shopId, 'transfers'),
    ])
    return NextResponse.json({ enabled: data.shops > 0, can_request: requests && (canSell || canTransfer), items: data.items })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
