import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { rows, shop_id } = await request.json()
    if (!shop_id) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: t('no_rows_to_import') }, { status: 400 })
    if (rows.length > 500) return NextResponse.json({ error: t('max_500_products') }, { status: 400 })

    // Verify user is an active member with write access to this shop
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()
    if (!memberRow || !['owner', 'manager', 'shop_manager', 'stock_manager'].includes(memberRow.role))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = createAdminClient() as any

    const errors: { line: number; error: string }[] = []
    const toInsert: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const lineNum = i + 2 // +2 because line 1 is header

      const name = String(row.name || '').trim()
      if (!name) { errors.push({ line: lineNum, error: t('missing_name') }); continue }

      const selling_price = parseFloat(String(row.selling_price || '0').replace(/[^\d.]/g, ''))
      if (isNaN(selling_price) || selling_price <= 0) {
        errors.push({ line: lineNum, error: t('invalid_selling_price_for', { name }) }); continue
      }

      const buying_price = parseFloat(String(row.buying_price || '0').replace(/[^\d.]/g, '')) || 0
      const quantity = parseInt(String(row.quantity || '0')) || 0
      const unit = String(row.unit || 'piece').trim() || 'piece'
      const sku = String(row.sku || '').trim() || null
      const low_stock_threshold = parseInt(String(row.low_stock_threshold || '')) || null

      toInsert.push({
        shop_id,
        name,
        unit,
        buying_price,
        selling_price,
        quantity,
        sku,
        low_stock_threshold,
        is_active: true,
      })
    }

    let inserted = 0
    if (toInsert.length > 0) {
      const { data, error } = await admin.from('products').insert(toInsert).select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      inserted = data?.length ?? 0

      // Record initial stock movements — same as the single Add Product flow
      // (POST /api/products) — so Mouvements shows a starting point regardless
      // of whether the product was created one-by-one, via Ajout rapide, or CSV.
      const movementRows = (data || [])
        .map((row: any, i: number) => ({ product_id: row.id, quantity: toInsert[i].quantity }))
        .filter((r: any) => r.quantity > 0)
        .map((r: any) => ({
          shop_id,
          product_id: r.product_id,
          type: 'in',
          quantity: r.quantity,
          reason: 'Stock initial',
          performed_by: user.id,
          previous_qty: 0,
          new_qty: r.quantity,
        }))
      if (movementRows.length > 0) {
        await admin.from('stock_movements').insert(movementRows)
      }
    }

    return NextResponse.json({ inserted, errors, skipped: errors.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
