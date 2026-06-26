import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

const BUCKET = 'temp-pdfs'

// POST { data: base64, filename } → { url: signedUrl }
// Uploads to Supabase Storage → returns real HTTPS signed URL with Content-Disposition: attachment
// Works on ALL Android devices (Samsung, Chrome, PWA standalone mode)
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? ''
    let data: string, filename: string

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      const params = new URLSearchParams(text)
      data = params.get('data') ?? ''
      filename = params.get('filename') ?? 'rapport.pdf'
    } else {
      const body = await req.json()
      data = body.data ?? ''
      filename = body.filename ?? 'rapport.pdf'
    }

    if (!data) return NextResponse.json({ error: 'No data' }, { status: 400 })

    const buffer = Buffer.from(data, 'base64')
    const supabase = await createAdminClient() as any

    // Create bucket if not exists (ignore error if already exists)
    await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: 15 * 1024 * 1024,
    })

    // Upload PDF with unique path
    const path = `${randomUUID()}.pdf`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'application/pdf', upsert: false })

    if (uploadError) throw uploadError

    // Signed URL valid 10 min with Content-Disposition: attachment → forces download on any browser
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 600, { download: filename })

    if (signError) throw signError

    // Clean up file after 15 min (fire and forget)
    setTimeout(async () => {
      await (await createAdminClient() as any).storage.from(BUCKET).remove([path])
    }, 15 * 60_000)

    return NextResponse.json({ url: signed.signedUrl })
  } catch (err) {
    console.error('[pdf-download]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
