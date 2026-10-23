import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { randomUUID } from 'crypto'
import { getApiTranslator } from '@/lib/api/i18n'

const BUCKET = 'temp-pdfs'

// POST { data: base64, filename, contentType? } → { url: signedUrl }
// Lien de téléchargement temporaire pour l'application installée sur l'écran d'accueil d'un iPhone, où un
// lien blob ne télécharge rien (lib/utils/save-file.tsx) : le fichier PRODUIT PAR L'APPLICATION (export
// PDF / CSV / Excel) est déposé dans un espace privé, puis servi par un lien signé de 10 min qui force le
// téléchargement.
// Correctif sécurité du 23 oct. 2026 — avant : aucune connexion exigée, type et nom libres, ce qui en faisait
// un hébergement de fichiers ouvert à tous sur notre domaine de stockage. Désormais :
//   • utilisateur connecté obligatoire ;
//   • types limités aux exports de l'application (PDF, CSV, Excel), taille plafonnée ;
//   • nom de fichier nettoyé (en-tête de téléchargement) ;
//   • les fichiers de plus de 30 min sont purgés à chaque appel (le minuteur en mémoire ne survit pas à
//     l'arrêt d'une fonction serverless).
const TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}
const MAX_BYTES = 10 * 1024 * 1024
const KEEP_MS = 30 * 60_000

const safeFileName = (name: string, ext: string) => {
  const base = name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'fichier'
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`
}

async function purgeOld(supabase: any) {
  const { data } = await supabase.storage.from(BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'asc' } })
  const old = (data || []).filter((f: any) => f.created_at && Date.now() - Date.parse(f.created_at) > KEEP_MS).map((f: any) => f.name)
  if (old.length) await supabase.storage.from(BUCKET).remove(old)
}

export async function POST(req: NextRequest) {
  const t = getApiTranslator(req)
  try {
    const { user } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const reqContentType = req.headers.get('content-type') ?? ''
    let data: string, filename: string, mimeType: string

    if (reqContentType.includes('application/x-www-form-urlencoded')) {
      const text = await req.text()
      const params = new URLSearchParams(text)
      data = params.get('data') ?? ''
      filename = params.get('filename') ?? 'fichier.pdf'
      mimeType = params.get('contentType') ?? 'application/pdf'
    } else {
      const body = await req.json()
      data = typeof body.data === 'string' ? body.data : ''
      filename = typeof body.filename === 'string' ? body.filename : 'fichier.pdf'
      mimeType = typeof body.contentType === 'string' ? body.contentType : 'application/pdf'
    }

    if (!data) return NextResponse.json({ error: t('no_data') }, { status: 400 })
    const mime = mimeType.split(';')[0].trim().toLowerCase()
    const ext = TYPES[mime]
    if (!ext) return NextResponse.json({ error: t('unsupported_format') }, { status: 400 })
    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length || buffer.length > MAX_BYTES) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const supabase = await createAdminClient() as any

    // Création de l'espace s'il n'existe pas (erreur ignorée s'il existe déjà)
    await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 15 * 1024 * 1024 })
    await purgeOld(supabase).catch(() => {})

    const path = `${randomUUID()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: mime, upsert: false })
    if (uploadError) throw uploadError

    // Lien signé de 10 min avec Content-Disposition: attachment → téléchargement forcé sur tout navigateur
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 600, { download: safeFileName(filename, ext) })
    if (signError) throw signError

    return NextResponse.json({ url: signed.signedUrl })
  } catch (err) {
    console.error('[pdf-download]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
