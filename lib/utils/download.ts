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
 * Télécharge un fichier sur tous les appareils :
 * - Navigateur desktop/mobile : blob URL + <a download> (rapide, sans serveur)
 * - PWA standalone Android/iOS : upload Supabase → URL signée → download natif
 *
 * Jette Error('OFFLINE') si hors ligne en mode PWA.
 */
export async function downloadFile(blob: Blob, filename: string): Promise<void> {
  const contentType = blob.type || 'application/octet-stream'

  if (!isPWAStandalone()) {
    // Navigateur standard (desktop ou mobile) : a.click() sur blob URL fonctionne
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }

  // PWA standalone : blob URL bloqué → Supabase Storage
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
}
