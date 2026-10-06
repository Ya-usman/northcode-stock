'use client'

/**
 * Télécharge (ENREGISTRE) un fichier — même règle partout (7 oct. 2026) :
 * voir lib/utils/save-file. Avant, sur téléphone, la feuille de partage
 * s'ouvrait en premier : le fichier partait vers WhatsApp/Gmail au lieu d'être
 * rangé sur le téléphone.
 */
export async function downloadFile(blob: Blob, filename: string): Promise<void> {
  const { saveFile } = await import('@/lib/utils/save-file')
  await saveFile(blob, filename)
}
