import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { supplierDebtShops } from '@/lib/api/supplier-access'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// GET /api/suppliers/balances?shop_ids=a,b
// LA source du solde dû aux fournisseurs pour les écrans (liste et fiche des
// fournisseurs). Le navigateur ne lit plus `suppliers.total_owed` lui-même :
// il lit les fournisseurs sans leur solde (lib/suppliers/columns) puis, si la
// personne en a le droit, demande les soldes ici.
//
// Droit : voir les dettes fournisseurs, boutique par boutique — Crédits en
// lecture ET Fournisseurs en lecture (lib/api/supplier-access). Seules les
// boutiques autorisées sont lues ; `shops` dit lesquelles. Aucune → 403.
// Lecture seule. Aucun prix d'achat : un solde n'est pas un coût unitaire.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = (new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { debts: allowed } = await supplierDebtShops(supabase, user.id, shopIds)
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const rows = await fetchAllRows<{ id: string; total_owed: number | null }>(() => admin
      .from('suppliers').select('id, total_owed')
      .in('shop_id', allowed).order('id', { ascending: true }))
    const balances: Record<string, number> = {}
    for (const r of rows) balances[r.id] = Number(r.total_owed) || 0
    return NextResponse.json({ shops: allowed, balances })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
