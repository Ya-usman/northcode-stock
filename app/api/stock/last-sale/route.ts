import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { fetchLastSaleAt } from '@/lib/stock/signals'

// GET /api/stock/last-sale?shop_ids=a,b&product_ids=x,y
// Date de la dernière vente de chaque produit demandé, sur 365 jours au plus (étape 15 du Stock, 31 oct. 2026) :
// « Dernière vente il y a 47 jours » sur les produits sans vente, et ancienneté du stock dormant dans la Vue
// d'ensemble. Même droit que /api/stock/sold-30d (« Stock » ou « Catégories ») et même raison de passer par le
// serveur : un caissier ne lit que SES ventes dans son navigateur. Des dates seulement, aucun montant ni client.
// Seuls les produits des boutiques autorisées sont lus (les autres identifiants sont ignorés).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const params = new URL(request.url).searchParams
    const shopIds = (params.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    const productIds = (params.get('product_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    if (!productIds.length) return NextResponse.json({ byProduct: {} })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowed: string[] = []
    await Promise.all((members || []).map(async (m: any) => {
      if (await canViewFeature(supabase, m.role, m.shop_id, 'stock') || await canViewFeature(supabase, m.role, m.shop_id, 'categories')) allowed.push(m.shop_id)
    }))
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    // Produits des boutiques autorisées seulement
    const { data: own } = await admin.from('products').select('id').in('shop_id', allowed).in('id', productIds.slice(0, 200))
    const ids = (own || []).map((p: any) => p.id)
    return NextResponse.json({ byProduct: ids.length ? await fetchLastSaleAt(admin, allowed, ids) : {} })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
