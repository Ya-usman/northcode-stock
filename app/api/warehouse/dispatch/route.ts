// POST /api/warehouse/dispatch
// Crée un bon de livraison et le passe en "dispatched"
// → déclenche le trigger SQL qui déduit le stock de l'entrepôt

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { warehouse_id, destination_id, items, notes } = await request.json()
    // items: [{ product_id, quantity, unit_cost }]

    if (!warehouse_id || !destination_id || !items?.length) {
      return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 })
    }

    const admin = await createAdminClient()

    // Vérifier stock suffisant pour chaque article
    for (const item of items) {
      const { data: product } = await admin
        .from('products')
        .select('quantity, name')
        .eq('id', item.product_id)
        .eq('shop_id', warehouse_id)
        .single()

      if (!product) {
        return NextResponse.json({ error: `Produit introuvable dans l'entrepôt` }, { status: 400 })
      }
      if ((product as any).quantity < item.quantity) {
        return NextResponse.json({
          error: `Stock insuffisant pour "${(product as any).name}" : ${(product as any).quantity} disponible(s), ${item.quantity} demandé(s)`
        }, { status: 400 })
      }
    }

    // Créer le bon de livraison (bordereau auto-généré par trigger)
    const { data: order, error: orderError } = await admin
      .from('delivery_orders')
      .insert({
        bordereau_number: '', // sera remplacé par le trigger
        warehouse_id,
        destination_id,
        status: 'draft',
        notes: notes || null,
        created_by: user.id,
      } as any)
      .select()
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: orderError?.message ?? 'Erreur création bon' }, { status: 500 })
    }

    const orderId = (order as any).id

    // Insérer les lignes produits
    const { error: itemsError } = await admin
      .from('delivery_order_items')
      .insert(
        items.map((item: any) => ({
          delivery_order_id: orderId,
          product_id: item.product_id,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_cost: item.unit_cost ?? 0,
        })) as any
      )

    if (itemsError) {
      await admin.from('delivery_orders').delete().eq('id', orderId)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }

    // Passer en "dispatched" → déclenche le trigger de déduction de stock
    const { data: dispatched, error: dispatchError } = await admin
      .from('delivery_orders')
      .update({ status: 'dispatched', dispatched_by: user.id } as any)
      .eq('id', orderId)
      .select()
      .single()

    if (dispatchError) {
      return NextResponse.json({ error: dispatchError.message }, { status: 500 })
    }

    return NextResponse.json({ order: dispatched })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
