import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/products/restore — restaurer un produit depuis deleted_records_log
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { log_id, shop_id } = await request.json()
    if (!log_id || !shop_id) return NextResponse.json({ error: t('log_shop_id_required') }, { status: 400 })

    // Réservé exclusivement au support StockShop (super_admin)
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if ((profile as any)?.role !== 'super_admin')
      return NextResponse.json({ error: t('support_only') }, { status: 403 })

    const admin = await createAdminClient() as any

    // Lire le snapshot depuis le journal
    const { data: log, error: logErr } = await admin
      .from('deleted_records_log')
      .select('record_data, table_name, shop_id')
      .eq('id', log_id)
      .eq('shop_id', shop_id)
      .single()

    if (logErr || !log) return NextResponse.json({ error: t('record_not_found') }, { status: 404 })

    if (log.table_name !== 'products') {
      return NextResponse.json({ error: t('restore_products_only') }, { status: 400 })
    }

    // Réinsérer le produit avec is_active = true, deleted_at = null
    const restored = {
      ...log.record_data,
      is_active: true,
      deleted_at: null,
    }

    // Vérifier si l'ID existe encore (cas rare : conflit)
    const { data: existing } = await admin
      .from('products')
      .select('id')
      .eq('id', restored.id)
      .maybeSingle()

    if (existing) {
      // Réactiver si la ligne existe encore (archived)
      await admin.from('products').update({ is_active: true }).eq('id', restored.id)
    } else {
      // Réinsérer le produit complet
      const { error: insertErr } = await admin.from('products').insert(restored)
      if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 400 })
    }

    // Supprimer l'entrée du journal (restauration réussie)
    await admin.from('deleted_records_log').delete().eq('id', log_id)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
