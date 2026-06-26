import { NextRequest, NextResponse } from 'next/server'

// Single-request: POST base64 PDF → returns PDF inline (for viewing/printing in browser)
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const data = formData.get('data') as string
    const filename = (formData.get('filename') as string) || 'rapport.pdf'
    if (!data) return NextResponse.json({ error: 'No data' }, { status: 400 })

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
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
