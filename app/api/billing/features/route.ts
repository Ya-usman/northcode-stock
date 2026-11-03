import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getShopFeatures, FEATURE_MIN_PLAN } from '@/lib/saas/plan-features'

// GET /api/billing/features?shop_id=…  (pure lecture)
// Fonctions permises par la formule de l'entreprise de la boutique (lib/saas/plan-features, la même règle que les
// routes qui refusent). Sert seulement à l'affichage : cadenas pour le propriétaire, fonction cachée pour les employés.
// Membre active de la boutique obligatoire.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const role = await checkShopRole(supabase, user.id, shopId)
  if (!role) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })
  const admin = await createAdminClient() as any
  const { plan, features } = await getShopFeatures(admin, shopId)
  return NextResponse.json({ plan, features, required: FEATURE_MIN_PLAN }, { headers: { 'Cache-Control': 'no-store' } })
}
