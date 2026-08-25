import { NextRequest, NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'

// Single-request: POST base64 PDF → returns PDF inline (for viewing/printing in browser)
export async function POST(req: NextRequest) {
  const t = getApiTranslator(req)
  try {
    const formData = await req.formData()
    const data = formData.get('data') as string
    const filename = (formData.get('filename') as string) || 'rapport.pdf'
    if (!data) return NextResponse.json({ error: t('no_data') }, { status: 400 })

    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const safe = encodeURIComponent(filename)
    return new NextResponse(bytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"; filename*=UTF-8''${safe}`,
        'Content-Length': String(bytes.length),
      },
    })
  } catch {
    return NextResponse.json({ error: t('invalid_request') }, { status: 400 })
  }
}
