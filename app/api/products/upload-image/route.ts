import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { sniffImage } from '@/lib/api/image-type'

// POST /api/products/upload-image (multipart : file, shop_id) → { url }
// Photo d'un produit, déposée dans le dossier de SA boutique (espace public product-images).
// Contrôles AVANT tout envoi (correctif sécurité du 23 oct. 2026 — avant : simple connexion, n'importe quel
// compte pouvait déposer un fichier dans le dossier d'une autre boutique, voire d'une autre entreprise) :
//   • identifiant de boutique valide ; membre actif de CETTE boutique ; droit Stock en modification
//     (même règle que la création / modification d'un produit, /api/products) ;
//   • type RÉEL lu dans le fichier (JPEG, PNG, WebP, GIF), jamais le type annoncé ; extension tirée de ce type ;
//   • 5 Mo au plus.
const MAX_SIZE_MB = 5
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file')
    const shopId = formData.get('shop_id')

    if (!(file instanceof File)) return NextResponse.json({ error: t('missing_file') }, { status: 400 })
    if (typeof shopId !== 'string' || !UUID.test(shopId)) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWriteFeature(supabase, role, shopId, 'stock'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: t('image_too_large', { size: MAX_SIZE_MB }) }, { status: 400 })
    }
    const buffer = Buffer.from(await file.arrayBuffer())
    const kind = sniffImage(buffer)
    if (!kind) return NextResponse.json({ error: t('unsupported_format') }, { status: 400 })

    const filename = `${shopId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${kind.ext}`
    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('product-images')
      .upload(filename, buffer, { contentType: kind.mime, upsert: false })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })

    const { data: { publicUrl } } = admin.storage.from('product-images').getPublicUrl(filename)

    return NextResponse.json({ url: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
