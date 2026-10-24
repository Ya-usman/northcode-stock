// Nettoyage des photos de traitement de lot (179) AVANT la suppression d'une boutique / d'un compte.
// 1. chemins enregistrés en base (batch_treatment_photos) + parcours de « {shop_id}/ » dans l'espace privé
//    (fichiers éventuellement orphelins) ; 2. suppression par l'API Storage ; 3. nouveau parcours : il ne doit
//    plus rien rester. S'il reste un fichier, la suppression de la boutique doit être REFUSÉE (la base le refuse
//    aussi : une référence de photo ne disparaît que si son fichier a quitté l'espace de stockage).
// Avant la 179 (espace ou table absents) : rien à nettoyer.
import { PHOTO_BUCKET } from '@/lib/api/batch-treatments'

async function listTree(admin: any, prefix: string, out: string[], depth = 0): Promise<void> {
  if (depth > 4) return
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(PHOTO_BUCKET).list(prefix, { limit: 1000, offset })
    if (error) throw new Error(error.message)
    for (const entry of data || []) {
      const path = `${prefix}/${entry.name}`
      if (entry.id) out.push(path)               // fichier
      else await listTree(admin, path, out, depth + 1) // dossier
    }
    if (!data || data.length < 1000) return
  }
}

async function bucketExists(admin: any): Promise<boolean> {
  const { data, error } = await admin.storage.getBucket(PHOTO_BUCKET)
  return !error && !!data
}

export async function purgeTreatmentPhotos(admin: any, shopIds: string[]):
  Promise<{ ok: true; removed: number } | { ok: false; error: string; remaining: string[] }> {
  if (!shopIds.length || !(await bucketExists(admin))) return { ok: true, removed: 0 }
  try {
    const paths = new Set<string>()
    const { data: rows, error } = await admin.from('batch_treatment_photos').select('storage_path').in('shop_id', shopIds)
    if (error && !['42P01', 'PGRST205'].includes(error.code)) throw new Error(error.message)
    for (const r of rows || []) paths.add(r.storage_path)
    for (const shopId of shopIds) { const found: string[] = []; await listTree(admin, shopId, found); found.forEach(p => paths.add(p)) }

    const all = Array.from(paths)
    for (let i = 0; i < all.length; i += 100) {
      const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove(all.slice(i, i + 100))
      if (rmErr) throw new Error(rmErr.message)
    }

    const remaining: string[] = []
    for (const shopId of shopIds) await listTree(admin, shopId, remaining)
    if (remaining.length) return { ok: false, error: 'photos_remaining', remaining }
    return { ok: true, removed: all.length }
  } catch (e: any) {
    return { ok: false, error: e.message || 'storage_error', remaining: [] }
  }
}
