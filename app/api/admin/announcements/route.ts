import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { validateAnnouncement, ANNOUNCEMENT_KINDS } from '@/lib/announcements/catalog'

// Admin → Nouveautés (Nouveautés V2, lot B). Lecture : tout administrateur ;
// création / modification / activation : administrateur complet, journalisé.
// Jamais de suppression : une annonce se désactive (brouillon).

const FIELDS = 'id, kind, title, description, title_en, description_en, title_ha, description_ha, target_path, cta_path, roles, published_at, expires_at, is_active'

/** Colonnes historiques (migration 070) tenues cohérentes avec le type */
const legacy = (kind: string) => {
  const k = ANNOUNCEMENT_KINDS.find(x => x.kind === kind) ?? ANNOUNCEMENT_KINDS[0]
  return { badge: k.badge, badge_color: k.color }
}

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const admin = await createAdminClient() as any
    const { data, error } = await admin.from('announcements').select(FIELDS).order('published_at', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Fermetures du bandeau, par annonce
    const { data: dis } = await admin.from('announcement_dismissals').select('announcement_id')
    const dismissed: Record<string, number> = {}
    for (const d of dis || []) dismissed[d.announcement_id] = (dismissed[d.announcement_id] || 0) + 1
    // Estimation « vue » : personnes ayant ouvert le panneau depuis la publication
    const rows = await Promise.all((data || []).map(async (a: any) => {
      let seen: number | null = null
      if (new Date(a.published_at).getTime() <= Date.now()) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).gte('last_seen_announcement_at', a.published_at)
        seen = count ?? null
      }
      return { ...a, stats: { dismissed: dismissed[a.id] || 0, seen } }
    }))
    return NextResponse.json({ announcements: rows })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const { value, errors } = validateAnnouncement(body)
    if (!value) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })
    const admin = await createAdminClient() as any
    const { data, error } = await admin.from('announcements').insert({ ...value, ...legacy(value.kind) }).select(FIELDS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeAuditLog({
      action: 'admin.announcement_create', actor_id: auth.user.id, actor_email: auth.user.email,
      target_id: data.id, target_type: 'announcement',
      metadata: { title: value.title, is_active: value.is_active, published_at: value.published_at, roles: value.roles, target_path: value.target_path },
      ip: getClientIp(request),
    })
    return NextResponse.json({ announcement: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  try {
    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Annonce invalide.' }, { status: 400 })
    const admin = await createAdminClient() as any
    const { data: before } = await admin.from('announcements').select(FIELDS).eq('id', id).maybeSingle()
    if (!before) return NextResponse.json({ error: 'Annonce introuvable.' }, { status: 404 })

    // Activation / désactivation seule, ou modification complète
    let update: Record<string, unknown>
    if (Object.keys(body).every(k => k === 'id' || k === 'is_active')) {
      if (typeof body.is_active !== 'boolean') return NextResponse.json({ error: 'Valeur invalide.' }, { status: 400 })
      update = { is_active: body.is_active }
    } else {
      const { value, errors } = validateAnnouncement({ ...before, ...body })
      if (!value) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })
      update = { ...value, ...legacy(value.kind) }
    }
    const { data, error } = await admin.from('announcements').update(update).eq('id', id).select(FIELDS).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const k of Object.keys(update)) {
      if (k === 'badge' || k === 'badge_color') continue
      if (JSON.stringify((before as any)[k]) !== JSON.stringify((data as any)[k])) changes[k] = { from: (before as any)[k], to: (data as any)[k] }
    }
    if (Object.keys(changes).length) {
      await writeAuditLog({
        action: 'admin.announcement_update', actor_id: auth.user.id, actor_email: auth.user.email,
        target_id: id, target_type: 'announcement', metadata: { title: data.title, changes }, ip: getClientIp(request),
      })
    }
    return NextResponse.json({ announcement: data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
