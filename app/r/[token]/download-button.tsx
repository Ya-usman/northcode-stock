'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

// « Télécharger le PDF » sur la page publique du reçu : le même A5 que dans
// l'app, généré dans le navigateur du client (jsPDF chargé à la demande).
export function DownloadReceiptButton({ data, label, className }: {
  data: Record<string, unknown>
  label: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const onClick = async () => {
    setBusy(true)
    try {
      const { generateReceiptPDF } = await import('@/lib/utils/pdf')
      await generateReceiptPDF(data as any)
    } catch {
      /* le bouton reste disponible pour réessayer */
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn('inline-flex items-center justify-center gap-2 rounded-lg bg-stockshop-blue px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60', className)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </button>
  )
}
