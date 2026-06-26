import { NextRequest, NextResponse } from 'next/server'

// POST { data: base64, filename } → PDF inline (used by Imprimer button)
export async function POST(req: NextRequest) {
  try {
    const { data, filename = 'rapport.pdf', disposition = 'attachment' } = await req.json()
    if (!data) return NextResponse.json({ error: 'No data' }, { status: 400 })
    const buffer = Buffer.from(data as string, 'base64')
    const safe = encodeURIComponent(String(filename))
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${safe}`,
        'Content-Length': String(buffer.length),
      },
    })
  } catch (err) {
    console.error('[pdf-download]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
