import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { fetchSoldQty30d } from '@/lib/stock/signals'

// GET /api/stock/sold-30d?shop_ids=a,b
// Quantité vendue par produit sur 30 jours, pour la liste du Stock (colonne
// « Ventes 30 j », stock dormant, couverture) et la page Catégories (droit
// « Stock » OU « Catégories », lot 2B du 26 oct. 2026). Lecture seule.
//
// Pourquoi par le serveur : la base ne laisse lire à un caissier que SES
// ventes. Lue dans son navigateur, la colonne valait donc 0 partout et tous
// les produits passaient en « Ventes lentes ». Ici, toute personne qui voit le
// Stock d'une boutique obtient le même chiffre — des quantités seulement,
// aucun montant, aucun nom de client.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = (new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

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
    return NextResponse.json({ byProduct: await fetchSoldQty30d(admin, allowed) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
