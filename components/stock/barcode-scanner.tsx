'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [supported] = useState(() => 'BarcodeDetector' in window)

  useEffect(() => {
    if (!supported) return

    let stream: MediaStream | null = null
    let animFrame: number
    let active = true

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!videoRef.current || !active) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'],
        })

        const scan = async () => {
          if (!active || !videoRef.current || videoRef.current.readyState < 2) {
            if (active) animFrame = requestAnimationFrame(scan)
            return
          }
          try {
            const results = await detector.detect(videoRef.current)
            if (results.length > 0 && active) {
              stop()
              onDetected(results[0].rawValue)
              return
            }
          } catch {}
          if (active) animFrame = requestAnimationFrame(scan)
        }
        scan()
      } catch (err: any) {
        setError(err.name === 'NotAllowedError' ? 'Accès caméra refusé' : err.message || 'Erreur caméra')
      }
    }

    const stop = () => {
      active = false
      cancelAnimationFrame(animFrame)
      stream?.getTracks().forEach(t => t.stop())
    }

    start()
    return () => stop()
  }, [supported, onDetected])

  if (!supported) {
    return (
      <div className="mt-2 p-3 bg-muted rounded-lg text-center space-y-1">
        <p className="text-xs text-muted-foreground">Scan caméra non disponible sur ce navigateur.</p>
        <p className="text-xs text-muted-foreground">Utilisez Chrome Android ou entrez le SKU manuellement.</p>
        <button onClick={onClose} className="text-xs text-blue-400 hover:underline mt-1">Fermer</button>
      </div>
    )
  }

  return (
    <div className="mt-2 rounded-lg overflow-hidden border border-border relative bg-black">
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 rounded-full p-1 transition-colors"
      >
        <X className="h-3.5 w-3.5 text-white" />
      </button>

      {error ? (
        <div className="p-6 text-center space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">Fermer</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="w-full h-44 object-cover" playsInline muted />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="border-2 border-green-400/80 rounded-md w-56 h-24 relative">
              <div className="absolute inset-x-0 top-1/2 h-px bg-green-400 animate-pulse" />
              <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-green-400 rounded-tl" />
              <div className="absolute top-0 right-0 w-3 h-3 border-t-2 border-r-2 border-green-400 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-3 h-3 border-b-2 border-l-2 border-green-400 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-green-400 rounded-br" />
            </div>
          </div>
          <p className="absolute bottom-2 inset-x-0 text-center text-xs text-white/70">
            Pointez vers le code-barres
          </p>
        </>
      )}
    </div>
  )
}
