'use client'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = rej
    r.readAsDataURL(blob)
  })
}

function isPWAStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  )
}

/**
 * Télécharge un fichier cross-platform.
 *
 * Ordre de priorité :
 * 1. Mobile (Android/iOS) → Web Share API : fonctionne en mode browser ET standalone,
 *    offline comme online. Affiche le sélecteur natif (Fichiers, Drive…).
 *    C'est l'approche originale qui fonctionnait — restaurée ici.
 *
 * 2. Fallback mobile/standalone (Web Share non dispo ou échoue) → Supabase Storage :
 *    upload base64 → URL signée → window.location.href.
 *    Nécessite internet ; jette OfflineError si hors ligne.
 *
 * 3. Desktop → blob URL + <a download> : rapide, sans serveur, aucun upload.
 */
export async function downloadFile(blob: Blob, filename: string): Promise<void> {
  const ua = navigator.userAgent
  const isAndroid = /Android/i.test(ua)
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const isMobile = isAndroid || isIOS
  const contentType = blob.type || 'application/octet-stream'

  // ── 1. Web Share API (mobile — browser ET standalone) ──────────────────────
  if (isMobile && typeof navigator.canShare === 'function') {
    const file = new File([blob], filename, { type: contentType })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e
        // canShare() mais share() échoue — tenter Supabase ci-dessous
      }
    }
  }

  // ── 2. Supabase signed URL (mobile sans Web Share, ou PWA standalone) ──────
  if (isMobile || isPWAStandalone()) {
    if (!navigator.onLine) {
      const err = new Error('OFFLINE')
      err.name = 'OfflineError'
      throw err
    }
    const base64 = await blobToBase64(blob)
    const resp = await fetch('/api/pdf-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: base64, filename, contentType }),
    })
    const json = await resp.json()
    if (json.error) throw new Error(json.error)
    window.location.href = json.url
    return
  }

  // ── 3. Desktop : blob URL + <a download> ───────────────────────────────────
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
