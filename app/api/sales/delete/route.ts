import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canWriteFeature, isManagerial } from '@/lib/api/role-permissions'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { sale_id } = await request.json()
    if (!sale_id) return NextResponse.json({ error: t('missing_sale_id') }, { status: 400 })

    const admin = await createAdminClient() as any

    // Get caller membership to check delete permission
    const { data: sale, error: saleErr } = await admin
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', sale_id)
      .single()

    if (saleErr || !sale) return NextResponse.json({ error: t('sale_not_found') }, { status: 404 })
    // Reprise de dette : jamais par l'Historique des ventes — elle s'annule depuis Crédits
    if (sale.sale_status === 'opening') return NextResponse.json({ error: t('opening_not_editable') }, { status: 400 })

    // Direction avec « Historique des ventes » en modification, ou membre
    // porteur du droit individuel « peut supprimer des ventes »
    const { data: member } = await supabase
      .from('shop_members')
      .select('role, can_delete_sales')
      .eq('shop_id', sale.shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!member) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const isOwnerOrAdmin = isManagerial(member.role) && await canWriteFeature(supabase, member.role, sale.shop_id, 'sales_history')
    if (!isOwnerOrAdmin && !member.can_delete_sales) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    // Atomic: restore stock (if active) + delete items/payments/sale in one DB transaction
    const { error: rpcErr } = await admin.rpc('delete_sale', {
      p_sale_id: sale_id,
      p_user_id: user.id,
    })

    if (rpcErr) throw rpcErr

    return NextResponse.json({ success: true, message: t('sale_deleted_permanently', { number: sale.sale_number }) })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
