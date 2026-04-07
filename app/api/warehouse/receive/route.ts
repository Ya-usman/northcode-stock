// POST /api/warehouse/receive
// La boutique destination saisit le numéro de bordereau
// → le bon passe en "received" → trigger SQL ajoute le stock à la boutique

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

    const { bordereau_number, shop_id } = await request.json()
    if (!bordereau_number || !shop_id) {
      return NextResponse.json({ error: 'bordereau_number et shop_id requis' }, { status: 400 })
    }

    const admin = await createAdminClient()

    // Trouver le bon par numéro de bordereau
    const { data: order, error: findError } = await admin
      .from('delivery_orders')
      .select('*, delivery_order_items(*, products(name, unit, selling_price))')
      .eq('bordereau_number', bordereau_number.trim().toUpperCase())
      .single()

    if (findError || !order) {
      return NextResponse.json({ error: `Bordereau "${bordereau_number}" introuvable` }, { status: 404 })
    }

    const o = order as any

    if (o.status === 'received') {
      return NextResponse.json({ error: 'Ce bordereau a déjà été réceptionné', already_received: true }, { status: 409 })
    }
    if (o.status === 'cancelled') {
      return NextResponse.json({ error: 'Ce bordereau a été annulé' }, { status: 409 })
    }
    if (o.status === 'draft') {
      return NextResponse.json({ error: 'Ce bordereau n\'a pas encore été expédié' }, { status: 409 })
    }
    if (o.destination_id !== shop_id) {
      return NextResponse.json({
        error: `Ce bordereau est destiné à une autre boutique`
      }, { status: 403 })
    }

    // Passer en "received" → déclenche le trigger d'ajout de stock
    const { data: received, error: receiveError } = await admin
      .from('delivery_orders')
      .update({ status: 'received', received_by: user.id } as any)
      .eq('id', o.id)
      .select('*, delivery_order_items(*, products(name, unit))')
      .single()

    if (receiveError) {
      return NextResponse.json({ error: receiveError.message }, { status: 500 })
    }

    return NextResponse.json({ order: received })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
