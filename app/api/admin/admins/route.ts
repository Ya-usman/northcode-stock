import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// GET /api/admin/admins — liste les administrateurs actifs de la plateforme
export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const admin = await createAdminClient() as any
  const { data, error } = await admin
    .from('admin_users')
    .select('id, user_id, email, tier, added_by, created_at')
    .is('revoked_at', null)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Résout le nom de qui a ajouté chaque admin, pour l'affichage.
  const adderIds = Array.from(new Set((data || []).map((a: any) => a.added_by).filter(Boolean)))
  let addedByNames: Record<string, string> = {}
  if (adderIds.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', adderIds)
    ;(profiles || []).forEach((p: any) => { addedByNames[p.id] = p.full_name })
  }

  const admins = (data || []).map((a: any) => ({ ...a, added_by_name: addedByNames[a.added_by] ?? null }))
  return NextResponse.json({ admins })
}

// POST /api/admin/admins — ajoute un administrateur (super_admin uniquement)
// body: { email, tier: 'super_admin' | 'support' }
export async function POST(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  const { email, tier } = await request.json()
  if (!email || !['super_admin', 'support'].includes(tier)) {
    return NextResponse.json({ error: 'email et tier valide requis' }, { status: 400 })
  }

  const admin = await createAdminClient() as any

  // Le compte doit déjà exister (comme /api/admin/assign-manager) — cette
  // route donne un accès plateforme à un compte, elle n'en crée pas.
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers()
  if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
  const targetUser = users.find((u: any) => u.email === email)
  if (!targetUser) return NextResponse.json({ error: `Aucun compte trouvé pour ${email}` }, { status: 404 })

  const { data: inserted, error } = await admin
    .from('admin_users')
    .insert({ user_id: targetUser.id, email, tier, added_by: user.id })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog({
    action: 'admin.grant_admin_access',
    actor_id: user.id,
    actor_email: user.email,
    target_id: targetUser.id,
    target_type: 'user',
    metadata: { email, tier },
    ip: getClientIp(request),
  })

  return NextResponse.json({ success: true, id: inserted?.id })
}

// DELETE /api/admin/admins?id=xxx — révoque l'accès admin (super_admin uniquement)
export async function DELETE(request: Request) {
  const auth = await requireAdmin({ tier: 'super_admin' })
  if (auth.error) return auth.error
  const { user } = auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

  const admin = await createAdminClient() as any
  const { data: target } = await admin.from('admin_users').select('user_id, email').eq('id', id).single()
  if (!target) return NextResponse.json({ error: 'Administrateur introuvable' }, { status: 404 })

  if (target.user_id === user.id) {
    return NextResponse.json({ error: 'Impossible de révoquer votre propre accès.' }, { status: 400 })
  }

  const { error } = await admin
    .from('admin_users')
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAuditLog({
    action: 'admin.revoke_admin_access',
    actor_id: user.id,
    actor_email: user.email,
    target_id: target.user_id,
    target_type: 'user',
    metadata: { email: target.email },
    ip: getClientIp(request),
  })

  return NextResponse.json({ success: true })
}
