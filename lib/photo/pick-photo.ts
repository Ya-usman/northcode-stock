'use client'

import { isCapacitor } from '@/lib/utils/native-share'
import { clearPhotoDraft, savePhotoDraft, type PhotoDraftInput } from './photo-draft'

export type PhotoSource = 'camera' | 'gallery'

/** L'utilisateur a refusé l'accès à l'appareil photo (à rouvrir dans les réglages du téléphone). */
export class PhotoPermissionError extends Error {}

// Taille cible : la photo arrive déjà réduite du natif. Plus de décodage d'une
// image de 12 à 50 Mpx dans le WebView, qui pouvait tuer le moteur de rendu
// (et donc l'application) sur les téléphones à peu de mémoire.
const MAX_PX = 1024
const QUALITY = 82

/**
 * Sélecteur natif disponible (application Android/iOS). Sur le web et en PWA,
 * les écrans gardent leur <input type="file"> : le navigateur gère lui-même la
 * capture sans risque de perdre la page.
 */
export function hasNativePhotoPicker(): boolean {
  return isCapacitor()
}

/**
 * Prise de vue ou choix dans la galerie via le plugin Camera. Renvoie null si
 * l'utilisateur annule. `draft` : saisie mise de côté le temps de la prise de
 * vue, reprise par PhotoRestoreHandler si Android détruit l'activité.
 *
 * On appelle getPhoto (déprécié dans la v8 au profit de takePhoto) à dessein :
 * c'est le seul chemin du plugin qui participe à la sauvegarde d'état de
 * Capacitor (saveInstanceState / appRestoredResult). takePhoto garde son
 * résultat en mémoire et le perd à la recréation de l'activité, exactement le
 * cas que l'on corrige ici.
 */
export async function pickPhotoNative(source: PhotoSource, draft?: PhotoDraftInput): Promise<File | null> {
  const { Camera, CameraSource, CameraResultType } = await import('@capacitor/camera')
  if (draft) savePhotoDraft(draft)
  try {
    const photo = await Camera.getPhoto({
      source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
      // Base64 plutôt qu'URI : l'URL _capacitor_file_ passerait par le service
      // worker, qui ne sait pas la servir ; l'image est déjà petite.
      resultType: CameraResultType.Base64,
      quality: QUALITY,
      width: MAX_PX,
      height: MAX_PX,
      correctOrientation: true,
      saveToGallery: false,
    })
    // Résultat arrivé normalement : plus rien à reprendre
    clearPhotoDraft()
    if (!photo.base64String) return null
    return fileFromBase64(photo.base64String, photo.format)
  } catch (err: any) {
    // Annulation ou refus : la prise de vue est terminée, le brouillon ne sert plus.
    // (Si l'activité est détruite, ce code ne s'exécute jamais : le brouillon
    // reste en place pour la reprise.)
    clearPhotoDraft()
    const message = String(err?.message ?? err ?? '')
    if (/cancel/i.test(message)) return null
    if (/denied|permission/i.test(message)) throw new PhotoPermissionError(message)
    throw err
  }
}

/** Reconstruit un File à partir du base64 renvoyé par le plugin (appel direct ou résultat restauré). */
export function fileFromBase64(base64: string, format?: string): File {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const raw = (format || 'jpeg').toLowerCase()
  const mime = raw === 'jpg' ? 'jpeg' : raw
  const ext = mime === 'jpeg' ? 'jpg' : mime
  return new File([bytes], `photo_${Date.now()}.${ext}`, { type: `image/${mime}` })
}
