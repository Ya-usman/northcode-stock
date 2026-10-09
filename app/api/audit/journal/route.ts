import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'

// GET /api/audit/journal?shop_id=&feature=stock|expenses[&actions=a,b&from=&to=&q=&limit=]
//
// Journal d'activité d'une fonction, pour qui a cette fonction en MODIFICATION
// (règle du 9 oct. 2026 : « modification » = tous les droits de la fonction,
// journal compris). La base n'ouvre audit_logs qu'au propriétaire : le serveur
// lit pour les autres rôles, limité aux actions de la fonction demandée.
const FEATURES: Record<string, { feature: 'stock' | 'expenses'; actions: string[]; search: string | null }> = {
  stock: {
    feature: 'stock',
    actions: ['create_product', 'update_product', 'update_batch_promo', 'bulk_update_promo', 'archive_product', 'restore_product', 'delete_product', 'bulk_delete_products', 'delete_all_products'],
    search: 'metadata->>product_name',
  },
  expenses: { feature: 'expenses', actions: ['expense.delete'], search: null },
}
const MAX_LIMIT = 500

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const p = new URL(request.url).searchParams
    const shopId = p.get('shop_id')
    const spec = FEATURES[p.get('feature') || '']
    if (!shopId || !spec) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, spec.feature))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const asked = (p.get('actions') || '').split(',').filter(Boolean)
    const actions = asked.length ? asked.filter(a => spec.actions.includes(a)) : spec.actions
    if (!actions.length) return NextResponse.json({ logs: [], count: 0 })
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.get('limit')) || 50))

    const admin = await createAdminClient() as any
    let query = admin.from('audit_logs').select('*', { count: 'exact' })
      .eq('shop_id', shopId).in('action', actions)
      .order('created_at', { ascending: false }).range(0, limit - 1)
    if (p.get('from')) query = query.gte('created_at', p.get('from'))
    if (p.get('to')) query = query.lte('created_at', p.get('to'))
    const q = (p.get('q') || '').trim()
    if (q && spec.search) query = query.ilike(spec.search, `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`)

    const { data, count, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ logs: data || [], count: typeof count === 'number' ? count : null })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
