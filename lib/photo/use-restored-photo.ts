'use client'

import { useEffect, useRef } from 'react'
import { consumeRestoredPhoto, PHOTO_RESTORED_EVENT, type PhotoDraftKind, type RestoredPhoto } from './photo-draft'

/**
 * Reçoit la photo et le brouillon restaurés pour ce type d'écran, que la page
 * soit montée avant l'événement (stock en attente consommé au montage) ou
 * après (événement). Le rappel est toujours la dernière version fournie.
 */
export function useRestoredPhoto(kind: PhotoDraftKind, onRestore: (restored: RestoredPhoto) => void): void {
  const callback = useRef(onRestore)
  callback.current = onRestore

  useEffect(() => {
    const pending = consumeRestoredPhoto(kind)
    if (pending) callback.current(pending)

    const onEvent = (event: Event) => {
      // Priorité au stock partagé (consommation unique) ; sinon la charge utile
      // portée par l'événement lui-même.
      const detail = (event as CustomEvent<RestoredPhoto>).detail
      const restored = consumeRestoredPhoto(kind) ?? (detail?.draft?.kind === kind ? detail : null)
      if (restored) callback.current(restored)
    }
    window.addEventListener(PHOTO_RESTORED_EVENT, onEvent)
    return () => window.removeEventListener(PHOTO_RESTORED_EVENT, onEvent)
  }, [kind])
}
