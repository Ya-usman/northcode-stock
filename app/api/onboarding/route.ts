import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { TOUR_IDS } from '@/lib/onboarding/tours'

// POST /api/onboarding — accompagnement « Bien démarrer » (migration 163) de la
// personne connectée : masquer / réafficher le guide, suivi des tours guidés.
//   { action: 'dismiss_guide' } · { action: 'restore_guide' }
//   { action: 'tour', tour: '<id>', status: 'started' | 'completed' | 'skipped' }
// Préférences personnelles : pas de journal d'audit.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json().catch(() => null)
    const action = body?.action
    const admin = await createAdminClient() as any
    const { data: row } = await admin.from('user_onboarding').select('tours').eq('user_id', user.id).maybeSingle()
    const now = new Date().toISOString()
    let update: Record<string, unknown>

    if (action === 'dismiss_guide') update = { guide_dismissed_at: now }
    else if (action === 'restore_guide') update = { guide_dismissed_at: null }
    else if (action === 'tour') {
      const tour = body?.tour, status = body?.status
      if (!TOUR_IDS.includes(tour) || !['started', 'completed', 'skipped'].includes(status)) {
        return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
      }
      const tours = { ...(row?.tours || {}) }
      const prev = tours[tour] || {}
      tours[tour] = status === 'started'
        ? { ...prev, started_at: now, status: prev.status === 'completed' ? 'completed' : 'started' }
        : { ...prev, status, ended_at: now }
      update = { tours }
    } else {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }

    const { data, error } = await admin.from('user_onboarding')
      .upsert({ user_id: user.id, ...update, updated_at: now }, { onConflict: 'user_id' })
      .select('guide_dismissed_at, tours').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ onboarding: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
