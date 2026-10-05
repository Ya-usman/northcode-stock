import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { RECEIPT_BUCKET, RECEIPT_ALLOWED_TYPES, RECEIPT_MAX_MB, receiptShopId } from '@/lib/expenses/receipts'

// Justificatifs de dépenses — espace privé (lot 2, migration 156).
// POST : envoi par le serveur (droit « Dépenses » en modification) → { path }
// GET ?path= : lien signé d'une heure (droit « Dépenses » en lecture) → 302

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const shopId = formData.get('shop_id') as string | null
    if (!file) return NextResponse.json({ error: t('missing_file') }, { status: 400 })
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, 'expenses'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    if (!RECEIPT_ALLOWED_TYPES.includes(file.type)) return NextResponse.json({ error: t('unsupported_format') }, { status: 400 })
    if (file.size > RECEIPT_MAX_MB * 1024 * 1024) return NextResponse.json({ error: t('image_too_large', { size: RECEIPT_MAX_MB }) }, { status: 400 })

    const ext = file.type === 'application/pdf' ? 'pdf' : (file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg')
    const path = `${shopId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const admin = await createAdminClient() as any
    const { error } = await admin.storage.from(RECEIPT_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ path })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const path = new URL(request.url).searchParams.get('path') || ''
    const shopId = receiptShopId(path)
    if (!shopId || path.includes('..')) return NextResponse.json({ error: t('receipt_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canViewFeature(supabase, role, shopId, 'expenses'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    const admin = await createAdminClient() as any
    const { data, error } = await admin.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) return NextResponse.json({ error: t('receipt_not_found') }, { status: 404 })
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=0' } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
