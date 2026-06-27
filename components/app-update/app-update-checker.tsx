'use client'

import { useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { isCapacitor } from '@/lib/utils/native-share'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AppUpdateChecker() {
  const [needsUpdate, setNeedsUpdate] = useState(false)
  const [storeUrl, setStoreUrl] = useState('')

  useEffect(() => {
    if (!isCapacitor()) return

    async function check() {
      try {
        const [info, res] = await Promise.all([
          App.getInfo(),
          fetch('/api/app-version', { cache: 'no-store', signal: AbortSignal.timeout(5000) }),
        ])
        if (!res.ok) return
        const { min_version_code, store_url } = await res.json()
        const currentCode = parseInt(info.build, 10)
        if (min_version_code > 0 && currentCode < min_version_code) {
          setStoreUrl(store_url)
          setNeedsUpdate(true)
        }
      } catch {
        // Silencieux — pas de réseau ou API indisponible
      }
    }

    // Délai de 3s après le montage pour ne pas bloquer le chargement initial
    const t = setTimeout(check, 3000)
    return () => clearTimeout(t)
  }, [])

  if (!needsUpdate) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6">
      <div className="w-full max-w-sm rounded-2xl bg-card shadow-2xl overflow-hidden">
        <div className="bg-stockshop-blue px-6 pt-6 pb-5">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 mx-auto mb-3">
            <RefreshCw className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-center text-lg font-bold text-white">Mise à jour disponible</h2>
          <p className="text-center text-sm text-blue-200 mt-1">
            Une nouvelle version de StockShop est disponible
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-sm text-muted-foreground text-center">
            Cette mise à jour contient des améliorations importantes. Veuillez mettre à jour l'application pour continuer.
          </p>

          <Button
            className="w-full h-11 bg-stockshop-blue hover:bg-stockshop-blue-light text-white font-semibold"
            onClick={() => {
              // market:// ouvre directement l'app Play Store sur Android
              window.open(
                storeUrl.replace('https://play.google.com/store/apps/', 'market://'),
                '_system'
              )
            }}
          >
            Mettre à jour
          </Button>
        </div>
      </div>
    </div>
  )
}
