import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { grantTrialByAdmin } from '@/lib/saas/trial-claim-server'

// Admin → Activation, « Essais à vérifier » (protection de l'essai, migration 213).
//   GET  (équipe)       → inscriptions des 60 derniers jours dont l'essai a été REFUSÉ (numéro déjà utilisé) ou
//                          SIGNALÉ (même appareil, même nom + ville qu'un essai récent). Aucun numéro affiché ici
//                          (le registre ne garde que des empreintes).
//   POST (super_admin)  { entity_id, reason } → essai de 30 jours accordé à la main (cas légitime : numéro partagé,
//                          erreur de saisie…), motif obligatoire, journalisé.

const DAY = 86_400_000

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const admin = await createAdminClient() as any
  const { data: claims, error } = await admin.from('trial_claims').select('id, entity_id, owner_user_id, source, granted, flags, created_at')
    .in('source', ['register', 'oauth']).gte('created_at', new Date(Date.now() - 60 * DAY).toISOString()).order('created_at', { ascending: false }).limit(200)
  if (error) return NextResponse.json({ rows: [], unavailable: true })
  const rows = (claims || []).filter((c: any) => !c.granted || (c.flags || []).length)
  const entityIds = Array.from(new Set(rows.map((r: any) => r.entity_id).filter(Boolean))) as string[]
  const ownerIds = Array.from(new Set(rows.map((r: any) => r.owner_user_id).filter(Boolean))) as string[]
  const [{ data: ents }, { data: profs }, { data: grants }] = await Promise.all([
    entityIds.length ? admin.from('entities').select('id, name, trial_status, trial_ends_at').in('id', entityIds) : { data: [] },
    ownerIds.length ? admin.from('profiles').select('id, full_name').in('id', ownerIds) : { data: [] },
    entityIds.length ? admin.from('trial_claims').select('entity_id, reason, created_at').eq('source', 'admin').in('entity_id', entityIds) : { data: [] },
  ])
  const ent = new Map((ents || []).map((e: any) => [e.id, e]))
  const prof = new Map((profs || []).map((p: any) => [p.id, p]))
  return NextResponse.json({
    rows: rows.map((r: any) => {
      const e: any = r.entity_id ? ent.get(r.entity_id) : null
      const g: any = (grants || []).find((x: any) => x.entity_id === r.entity_id)
      return {
        id: r.id, entity_id: r.entity_id, entity_name: e?.name ?? null, owner_name: (prof.get(r.owner_user_id) as any)?.full_name ?? null,
        source: r.source, granted: r.granted, flags: r.flags || [], created_at: r.created_at,
        trial_status: e?.trial_status ?? null, deleted: !e, admin_grant: g ? { reason: g.reason, at: g.created_at } : null,
      }
    }),
  })
}

export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const body = await request.json().catch(() => ({}))
  const entityId = String(body?.entity_id || ''), reason = String(body?.reason || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(entityId)) return NextResponse.json({ error: 'Entreprise invalide' }, { status: 400 })
  if (reason.length < 3 || reason.length > 300) return NextResponse.json({ error: 'Motif obligatoire (3 à 300 caractères)' }, { status: 400 })
  const admin = await createAdminClient() as any
  const { data: e } = await admin.from('entities').select('id, name, trial_status').eq('id', entityId).maybeSingle()
  if (!e) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
  if (e.trial_status !== 'refused') return NextResponse.json({ error: 'Seul un essai refusé peut être accordé ici' }, { status: 409 })
  const r = await grantTrialByAdmin(admin, entityId, auth.user.id, reason)
  if (!r.ok) return NextResponse.json({ error: r.error || 'Action refusée' }, { status: 500 })
  const { data: shop } = await admin.from('shops').select('id').eq('entity_id', entityId).is('deleted_at', null).limit(1).maybeSingle()
  await writeAuditLog({
    action: 'admin.trial_grant', shop_id: shop?.id ?? null, actor_id: auth.user.id, actor_email: auth.user.email, target_id: entityId, target_type: 'entity',
    metadata: { reason, entity_name: e.name }, ip: getClientIp(request),
  })
  return NextResponse.json({ ok: true })
}
