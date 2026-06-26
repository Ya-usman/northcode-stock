import { NextRequest, NextResponse } from 'next/server'

// Accepts application/x-www-form-urlencoded OR JSON
// Returns PDF with Content-Disposition: attachment → browser downloads without navigating
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
    const safe = encodeURIComponent(String(filename))
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${safe}`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err) {
    console.error('[pdf-download]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
