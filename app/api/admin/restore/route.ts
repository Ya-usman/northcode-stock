import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { requireAdmin } from '@/lib/api/require-admin'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/admin/restore?shop_id=<id> — listes du panneau de restauration (components/admin/shop-restore-panel) :
// produits supprimés (journal), produits archivés, clients supprimés. Lues jusqu'ici DIRECTEMENT par le navigateur :
// la base ne les montre qu'aux membres de la boutique (et les clients supprimés à personne) → deux listes toujours
// vides pour le support (26 oct. 2026). Réservé au super admin, comme les restaurations ci-dessous.
export async function GET(request: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const shop_id = new URL(request.url).searchParams.get('shop_id') || ''
    if (!UUID.test(shop_id)) return NextResponse.json({ error: 'shop_id invalide' }, { status: 400 })
    const admin = await createAdminClient() as any
    const [deleted, archived, customers] = await Promise.all([
      admin.from('deleted_records_log').select('id, deleted_at, deleted_by, record_data')
        .eq('shop_id', shop_id).eq('table_name', 'products').order('deleted_at', { ascending: false }),
      admin.from('products').select('id, name, selling_price, quantity, unit, updated_at')
        .eq('shop_id', shop_id).eq('is_active', false).order('updated_at', { ascending: false }),
      admin.from('customers').select('id, name, phone, total_debt, deleted_at')
        .eq('shop_id', shop_id).not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    ])
    const error = deleted.error || archived.error || customers.error
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ deleted_products: deleted.data || [], archived_products: archived.data || [], deleted_customers: customers.data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const { user } = auth

    const { action, product_id, customer_id, shop_id } = await request.json()
    // La fiche doit appartenir à la boutique indiquée (avant : seul l'identifiant comptait, la boutique ne servait
    // qu'au journal)
    if (!UUID.test(String(shop_id || ''))) return NextResponse.json({ error: 'shop_id invalide' }, { status: 400 })
    const admin = await createAdminClient() as any

    if (action === 'reactivate_product') {
      if (!product_id) return NextResponse.json({ error: 'product_id requis' }, { status: 400 })
      const { data, error } = await admin.from('products').update({ is_active: true }).eq('id', product_id).eq('shop_id', shop_id).select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data?.length) return NextResponse.json({ error: 'Produit introuvable dans cette boutique' }, { status: 404 })
      await writeAuditLog({ action: 'admin.restore_product', shop_id, actor_id: user.id, actor_email: user.email, target_id: product_id, target_type: 'product', ip: getClientIp(request) })
      return NextResponse.json({ success: true })
    }

    if (action === 'restore_customer') {
      if (!customer_id) return NextResponse.json({ error: 'customer_id requis' }, { status: 400 })
      const { data, error } = await admin.from('customers').update({ deleted_at: null }).eq('id', customer_id).eq('shop_id', shop_id).select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!data?.length) return NextResponse.json({ error: 'Client introuvable dans cette boutique' }, { status: 404 })
      await writeAuditLog({ action: 'admin.restore_customer', shop_id, actor_id: user.id, actor_email: user.email, target_id: customer_id, target_type: 'customer', ip: getClientIp(request) })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
