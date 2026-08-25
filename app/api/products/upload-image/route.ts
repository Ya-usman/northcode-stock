import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_SIZE_MB = 5

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const shopId = formData.get('shop_id') as string | null

    if (!file) return NextResponse.json({ error: t('missing_file') }, { status: 400 })
    if (!shopId) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: t('unsupported_format') }, { status: 400 })
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json({ error: t('image_too_large', { size: MAX_SIZE_MB }) }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const filename = `${shopId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('product-images')
      .upload(filename, buffer, { contentType: file.type, upsert: false })

    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })

    const { data: { publicUrl } } = admin.storage.from('product-images').getPublicUrl(filename)

    return NextResponse.json({ url: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
