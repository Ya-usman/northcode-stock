// Suppression définitive de boutiques entières — compatible avant / après la migration 179.
// Après la 179, une allocation vente ↔ lot interdit la suppression d'un lot vendu ; lors de la suppression d'une
// boutique, lots et allocations doivent partir ensemble : la fonction delete_shops diffère CETTE seule clé le
// temps du DELETE puis rétablit le contrôle immédiat (un DELETE ordinaire serait refusé dès qu'un lot est vendu).
// Repli sur le DELETE d'origine UNIQUEMENT si la fonction n'existe pas encore (PGRST202, avant la 179). Toute
// autre erreur (fichier photo encore stocké, clé étrangère, droits, délai dépassé, base…) est renvoyée telle quelle —
// jamais de repli silencieux. Ordre de mise en ligne : CE code d'abord, la migration 179 ensuite.
//
// Les photos de traitement de lot doivent être retirées de l'espace de stockage AVANT (purgeTreatmentPhotos).
// Limite connue (acceptée en V1) : Storage et PostgreSQL ne partagent pas de transaction. Si les fichiers ont été
// supprimés puis que la suppression de la boutique échoue, la boutique reste SANS ces photos : rien n'est
// restauré ni recréé ; l'appelant renvoie une erreur explicite et l'inscrit au journal d'audit.

export async function deleteShops(admin: any, shopIds: string[]): Promise<{ error: { message: string; code?: string } | null }> {
  const ids = Array.from(new Set(shopIds.filter(Boolean)))
  if (!ids.length) return { error: null }
  const { error } = await admin.rpc('delete_shops', { p_shop_ids: ids })
  if (!error) return { error: null }
  if (error.code !== 'PGRST202') return { error }
  const { error: legacyError } = await admin.from('shops').delete().in('id', ids)
  return { error: legacyError ?? null }
}
