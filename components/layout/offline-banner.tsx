'use client'

import { useEffect, useState } from 'react'
import { WifiOff } from 'lucide-react'

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(true)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      // Keep banner visible briefly to confirm reconnection
      setTimeout(() => setVisible(false), 2000)
    }
    const handleOffline = () => {
      setIsOnline(false)
      setVisible(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (!visible) return null

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
        isOnline
          ? 'bg-green-500 text-white'
          : 'bg-gray-900 text-white'
      }`}
    >
      {isOnline ? (
        <span>Connexion rétablie ✓</span>
      ) : (
        <>
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Hors connexion — les ventes restent accessibles</span>
        </>
      )}
    </div>
  )
}
