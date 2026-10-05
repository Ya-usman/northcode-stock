import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/shops/logo { shop_id } — enregistre le logo que le propriétaire
// vient d'envoyer dans l'espace « shop-logos » (dossier de SA boutique).
// L'adresse est calculée ici, jamais fournie par le navigateur (lot 4 :
// plus d'écriture directe sur shops depuis le navigateur).
const BUCKET = 'shop-logos'
const FILE = 'logo.png'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { shop_id } = await request.json().catch(() => ({}))
    if (!shop_id) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })

    // Propriétaire seulement (même règle que les réglages de la boutique)
    const { data: member } = await supabase.from('shop_members').select('role')
      .eq('shop_id', shop_id).eq('user_id', user.id).eq('is_active', true).maybeSingle()
    if (!member || !['owner', 'super_admin'].includes(member.role)) {
      return NextResponse.json({ error: t('owner_only_settings') }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    // Le fichier doit exister dans le dossier de la boutique
    const { data: files } = await admin.storage.from(BUCKET).list(shop_id, { search: FILE })
    if (!(files || []).some((f: any) => f.name === FILE)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(`${shop_id}/${FILE}`)
    const logoUrl = `${publicUrl}?t=${Date.now()}` // force le rafraîchissement des caches
    const { error } = await admin.from('shops').update({ logo_url: logoUrl }).eq('id', shop_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog({
      action: 'shop.update_logo',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: shop_id,
      target_type: 'shop',
      ip: getClientIp(request),
    })
    return NextResponse.json({ success: true, logo_url: logoUrl })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
