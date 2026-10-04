'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useToast } from '@/components/ui/use-toast'
import { isCapacitor } from '@/lib/utils/native-share'
import { fileFromBase64 } from '@/lib/photo/pick-photo'
import { clearPhotoDraft, publishRestoredPhoto, readPhotoDraft } from '@/lib/photo/photo-draft'

// Android peut détruire l'activité pendant que l'app caméra est au premier
// plan ; au retour, le WebView repart de zéro. Capacitor rejoue alors le
// résultat de l'appel Camera.getPhoto via appRestoredResult (événement retenu
// jusqu'à ce qu'un écouteur existe). On le rapproche du brouillon mis de côté
// avant la prise de vue (photo-draft) et on rouvre l'écran concerné avec la
// saisie et la photo. Application native uniquement.
export function PhotoRestoreHandler() {
  const router = useRouter()
  const t = useTranslations('photo')
  const { toast } = useToast()

  useEffect(() => {
    if (!isCapacitor()) return
    let remove: (() => void) | null = null

    import('@capacitor/app').then(({ App }) => {
      const handle = App.addListener('appRestoredResult', (event) => {
        if (event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return
        const draft = readPhotoDraft()
        clearPhotoDraft()
        // Pas de brouillon (expiré, ou prise de vue sans saisie à reprendre) : rien à rouvrir
        if (!draft) return

        let file: File | null = null
        if (event.success && event.data?.base64String) {
          try { file = fileFromBase64(event.data.base64String, event.data.format) } catch { file = null }
        }
        // Annulation côté caméra : on rouvre quand même le formulaire tel qu'il était
        publishRestoredPhoto({ draft, file })
        toast({ title: file ? t('restored') : t('restored_no_photo'), variant: 'success' })
        // Lu au moment de l'événement, pas au montage : la page a pu changer entre-temps
        if (window.location.pathname !== draft.route) router.push(draft.route)
      })
      remove = () => { handle.then(h => h.remove()) }
    })

    return () => { remove?.() }
  }, [router, t, toast])

  return null
}
