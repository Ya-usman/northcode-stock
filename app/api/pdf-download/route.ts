import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

type Entry = { bytes: Uint8Array; filename: string; expires: number }

// In-memory temp store: valid for 10 minutes, one-time use
const store: Record<string, Entry> = {}

function purge() {
  const now = Date.now()
  for (const id of Object.keys(store)) {
    if (store[id].expires < now) delete store[id]
  }
}

// POST /api/pdf-download  { data: base64, filename: string } → { id }
export async function POST(req: NextRequest) {
  purge()
  const { data, filename } = await req.json()
  const binary = atob(data as string)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const id = randomUUID()
  store[id] = { bytes, filename: String(filename || 'rapport.pdf'), expires: Date.now() + 10 * 60_000 }
  return NextResponse.json({ id })
}

// GET /api/pdf-download?id=... → PDF with Content-Disposition: attachment
export async function GET(req: NextRequest) {
  purge()
  const id = new URL(req.url).searchParams.get('id') ?? ''
  const entry = store[id]
  if (!entry || entry.expires < Date.now()) {
    delete store[id]
    return NextResponse.json({ error: 'Lien expiré ou introuvable' }, { status: 404 })
  }
  delete store[id]
  const safe = encodeURIComponent(entry.filename)
  return new NextResponse(entry.bytes.buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${entry.filename}"; filename*=UTF-8''${safe}`,
      'Content-Length': String(entry.bytes.length),
    },
  })
}
