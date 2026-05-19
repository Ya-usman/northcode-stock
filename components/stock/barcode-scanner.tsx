'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/browser'

interface Props {
  onDetected: (code: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const reader = new BrowserMultiFormatReader()
    readerRef.current = reader

    reader.decodeFromConstraints(
      { video: { facingMode: 'environment' } },
      videoRef.current!,
      (result, err) => {
        if (result) {
          onDetected(result.getText())
          reader.reset()
          return
        }
        if (err && !(err instanceof NotFoundException)) {
          if ((err as any)?.name === 'NotAllowedError') {
            setError('Accès caméra refusé. Autorisez l\'accès dans les réglages.')
          }
        }
      }
    ).then(() => {
      setReady(true)
    }).catch((err: any) => {
      if (err?.name === 'NotAllowedError') {
        setError('Accès caméra refusé. Autorisez l\'accès dans les réglages.')
      } else {
        setError(err?.message || 'Impossible d\'accéder à la caméra.')
      }
    })

    return () => {
      reader.reset()
    }
  }, [onDetected])

  return (
    <div className="mt-2 rounded-xl overflow-hidden border border-border relative bg-black">
      <button
        onClick={onClose}
        className="absolute top-2 right-2 z-10 bg-black/60 hover:bg-black/80 rounded-full p-1.5 transition-colors"
      >
        <X className="h-3.5 w-3.5 text-white" />
      </button>

      {error ? (
        <div className="p-5 text-center space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">Fermer</button>
        </div>
      ) : (
        <>
          <video ref={videoRef} className="w-full h-48 object-cover" playsInline muted />

          {/* Loading overlay */}
          {!ready && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="h-6 w-6 text-white animate-spin" />
            </div>
          )}

          {/* Scan frame */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-24 relative">
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-green-400 rounded-tl" />
              <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-green-400 rounded-tr" />
              <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-green-400 rounded-bl" />
              <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-green-400 rounded-br" />
              <div className="absolute inset-x-0 top-1/2 h-px bg-green-400/70 animate-pulse" />
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
