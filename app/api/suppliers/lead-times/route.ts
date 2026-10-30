import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { leadTimeOf, observedLeadDays } from '@/lib/stock/replenishment'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/suppliers/lead-times?shop_ids=a,b
// Délai de livraison des fournisseurs : déclaré dans la fiche (colonne 189, réservée au serveur) et constaté sur les
// bons reçus. Droit : Fournisseurs en lecture, boutique par boutique. `supported` = la colonne existe (après la 189) :
// avant, l'écran n'affiche pas le champ de saisie.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = Array.from(new Set((new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(s => UUID.test(s))))
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { data: members } = await supabase.from('shop_members').select('shop_id, role').in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowed: string[] = []
    await Promise.all((members || []).map(async (m: any) => { if (await canViewFeature(supabase, m.role, m.shop_id, 'suppliers')) allowed.push(m.shop_id) }))
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    let supported = true
    let rows: any[] = []
    const withLead = await admin.from('suppliers').select('id, lead_time_days').in('shop_id', allowed).is('deleted_at', null)
    if (withLead.error) {
      supported = false
      const plain = await admin.from('suppliers').select('id').in('shop_id', allowed).is('deleted_at', null)
      if (plain.error) throw plain.error
      rows = plain.data || []
    } else rows = withLead.data || []
    const { data: received, error } = await admin.from('purchase_orders').select('supplier_id, sent_at, received_at')
      .in('shop_id', allowed).in('status', ['received', 'partial']).not('sent_at', 'is', null).not('received_at', 'is', null)
    if (error) throw error
    const observed = observedLeadDays(received || [])

    const data: Record<string, { declared: number | null; observed: number | null; days: number | null; source: 'declared' | 'observed' | null }> = {}
    for (const r of rows) {
      const declared = supported ? (r.lead_time_days ?? null) : null
      const lt = leadTimeOf(declared, observed[r.id])
      data[r.id] = { declared, observed: observed[r.id] ?? null, days: lt?.days ?? null, source: lt?.source ?? null }
    }
    return NextResponse.json({ supported, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
