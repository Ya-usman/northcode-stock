import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { batchTreatmentsAvailable } from '@/lib/api/batch-treatments'

// GET /api/stock/batch-treatments/status — { available } : la migration 179 (traitement des lots) est-elle
// appliquée ? Permet à l'interface d'afficher « Traiter le lot périmé », l'historique et les notes de correction
// seulement quand le serveur sait les enregistrer. Aucune donnée de boutique n'est lue.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const { user } = await getAuthedUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
  const admin = await createAdminClient() as any
  return NextResponse.json({ available: await batchTreatmentsAvailable(admin) }, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
