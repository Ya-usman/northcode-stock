import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { rows, shop_id } = await request.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id manquant' }, { status: 400 })
    if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: 'Aucune ligne à importer' }, { status: 400 })
    if (rows.length > 500) return NextResponse.json({ error: 'Maximum 500 produits par import' }, { status: 400 })

    // Verify user is an active member with write access to this shop
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()
    if (!memberRow || !['owner', 'manager', 'shop_manager', 'stock_manager'].includes(memberRow.role))
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = createAdminClient() as any

    const errors: { line: number; error: string }[] = []
    const toInsert: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const lineNum = i + 2 // +2 because line 1 is header

      const name = String(row.name || '').trim()
      if (!name) { errors.push({ line: lineNum, error: 'Nom manquant' }); continue }

      const selling_price = parseFloat(String(row.selling_price || '0').replace(/[^\d.]/g, ''))
      if (isNaN(selling_price) || selling_price <= 0) {
        errors.push({ line: lineNum, error: `Prix de vente invalide pour "${name}"` }); continue
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
    }

    return NextResponse.json({ inserted, errors, skipped: errors.length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
