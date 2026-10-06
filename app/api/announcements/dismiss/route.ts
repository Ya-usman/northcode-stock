import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/announcements/dismiss { announcement_id } — la personne connectée
// ferme le bandeau d'une nouveauté ; il ne lui est plus montré (migration 162).
// Préférence d'affichage personnelle : pas de journal d'audit.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { announcement_id } = await request.json().catch(() => ({}))
    if (typeof announcement_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(announcement_id)) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }
    const admin = await createAdminClient() as any
    const { data: ann } = await admin.from('announcements').select('id').eq('id', announcement_id).eq('is_active', true).maybeSingle()
    if (!ann) return NextResponse.json({ error: t('invalid_data') }, { status: 404 })
    const { error } = await admin.from('announcement_dismissals')
      .upsert({ user_id: user.id, announcement_id }, { onConflict: 'user_id,announcement_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
