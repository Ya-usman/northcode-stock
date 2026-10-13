import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { checkRateLimit } from '@/lib/rate-limit'
import { getApiTranslator } from '@/lib/api/i18n'
import { HELD_CART_SOURCE, RESERVATION_MAX_LINES, normalizeReservationItems, reservationExpiry } from '@/lib/stock/reservations'

// Stock réservé par les factures « mises en attente » à la caisse
// (migration 172, règles dans lib/stock/reservations).
//
//   PUT    { shop_id, source_ref, label?, age_ms?, items: [{ product_id, quantity }] }
//          remplace la réservation de cette facture ; fin = 24 h après la mise en attente
//   DELETE ?shop_id=…&source_ref=…   libère la réservation de cette facture
//
// Droit : celui de vendre dans la boutique (« Nouvelle vente », modification).
// La réservation est indicative : rien ici ne touche aux ventes ni au stock.

const CHUNK = 100

async function authorize(request: Request, shopId: unknown, sourceRef: unknown) {
  const t = getApiTranslator(request)
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  const ref = typeof sourceRef === 'string' ? sourceRef.trim() : ''
  if (typeof shopId !== 'string' || !shopId || !ref || ref.length > 120) {
    return { error: NextResponse.json({ error: t('invalid_data') }, { status: 400 }) }
  }
  const role = await checkShopRole(supabase, user.id, shopId)
  if (!role || !(await canWriteFeature(supabase, role, shopId, 'new_sale'))) {
    return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  }
  return { user, shopId, ref }
}

export async function PUT(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited
  const t = getApiTranslator(request)
  try {
    const body = await request.json().catch(() => null)
    const auth = await authorize(request, body?.shop_id, body?.source_ref)
    if (auth.error) return auth.error
    const { user, shopId, ref } = auth
    if (!Array.isArray(body.items) || body.items.length > RESERVATION_MAX_LINES) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }

    const admin = await createAdminClient() as any
    const mine = () => admin.from('stock_reservations').delete().eq('shop_id', shopId).eq('source', HELD_CART_SOURCE).eq('source_ref', ref)

    // Stock physique des produits demandés, dans CETTE boutique uniquement
    const ids = Array.from(new Set(body.items.map((i: any) => i?.product_id).filter((id: unknown) => typeof id === 'string' && id))) as string[]
    const physicalById: Record<string, number> = {}
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await admin.from('products').select('id, quantity')
        .eq('shop_id', shopId).eq('is_active', true).in('id', ids.slice(i, i + CHUNK))
      if (error) throw error
      for (const p of data || []) physicalById[p.id] = Number(p.quantity)
    }

    const lines = normalizeReservationItems(body.items, physicalById)
    const now = Date.now()
    const expires = reservationExpiry(now, body.age_ms)

    // Réservations échues de la boutique : effacées au passage
    await admin.from('stock_reservations').delete().eq('shop_id', shopId).lt('expires_at', new Date(now).toISOString())

    if (!expires || !lines.length) {
      const { error } = await mine()
      if (error) throw error
      return NextResponse.json({ ok: true, lines: 0 })
    }

    // Les nouvelles lignes d'abord, puis le retrait de celles qui ont quitté le
    // panier : la réservation n'est jamais vide entre les deux.
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 120) : null
    const { error: upsertError } = await admin.from('stock_reservations').upsert(
      lines.map(l => ({
        shop_id: shopId, product_id: l.product_id, quantity: l.quantity,
        source: HELD_CART_SOURCE, source_ref: ref, label,
        created_by: user.id, expires_at: expires.toISOString(),
      })),
      { onConflict: 'shop_id,source,source_ref,product_id' },
    )
    if (upsertError) throw upsertError

    const keep = new Set(lines.map(l => l.product_id))
    const { data: existing, error: readError } = await admin.from('stock_reservations').select('id, product_id')
      .eq('shop_id', shopId).eq('source', HELD_CART_SOURCE).eq('source_ref', ref)
    if (readError) throw readError
    const stale = (existing || []).filter((r: any) => !keep.has(r.product_id)).map((r: any) => r.id)
    for (let i = 0; i < stale.length; i += CHUNK) {
      const { error } = await admin.from('stock_reservations').delete().in('id', stale.slice(i, i + CHUNK))
      if (error) throw error
    }

    return NextResponse.json({ ok: true, lines: lines.length, expires_at: expires.toISOString() })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited
  try {
    const params = new URL(request.url).searchParams
    const auth = await authorize(request, params.get('shop_id'), params.get('source_ref'))
    if (auth.error) return auth.error

    const admin = await createAdminClient() as any
    const { error } = await admin.from('stock_reservations').delete()
      .eq('shop_id', auth.shopId).eq('source', HELD_CART_SOURCE).eq('source_ref', auth.ref)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
