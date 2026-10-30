import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/shops/entity-count?shop_id=<boutique>
// Nombre de boutiques actives de l'entreprise de cette boutique (rien d'autre : ni noms ni chiffres). Sert à montrer
// l'onglet Transferts à une personne qui ne gère qu'UNE boutique d'une entreprise qui en a plusieurs (demandes de
// transfert reçues, décision du 30 oct. 2026). Droit : membre actif de la boutique.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  if (!UUID.test(shopId)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const { data: member } = await supabase.from('shop_members').select('shop_id').eq('shop_id', shopId).eq('user_id', user.id).eq('is_active', true).maybeSingle()
  if (!member) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
  const admin = await createAdminClient() as any
  const { data: shop } = await admin.from('shops').select('entity_id').eq('id', shopId).maybeSingle()
  if (!shop?.entity_id) return NextResponse.json({ count: 1 })
  const { count } = await admin.from('shops').select('id', { count: 'exact', head: true }).eq('entity_id', shop.entity_id).is('deleted_at', null)
  return NextResponse.json({ count: count ?? 1 })
}
