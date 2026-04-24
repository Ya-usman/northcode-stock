'use client'

/**
 * Detects if running inside a Capacitor native app (Android/iOS).
 */
function isCapacitor(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.()
}

/**
 * Convert a Blob to a base64 string (without the data: prefix).
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1]) // strip "data:...;base64,"
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Share a PDF blob on Android/iOS using Capacitor's native share sheet.
 * Falls back to browser Web Share API, then to a new-tab download.
 */
export async function sharePDFNative(blob: Blob, fileName: string, title: string): Promise<void> {
  // ── Capacitor native path ─────────────────────────────────
  if (isCapacitor()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')

    const base64 = await blobToBase64(blob)

    // Write to cache directory
    const writeResult = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    })

    await Share.share({
      title,
      url: writeResult.uri,
      dialogTitle: title,
    })
    return
  }

  // ── Web: native share API (mobile browsers) ───────────────
  const file = new File([blob], fileName, { type: 'application/pdf' })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title })
    return
  }

  // ── Desktop fallback: open in new tab ─────────────────────
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Open a PDF for printing.
 * On Capacitor: shares the PDF (user picks printer or PDF app).
 * On web: opens in new tab and triggers print dialog.
 */
export async function printPDFNative(blob: Blob, fileName: string): Promise<void> {
  if (isCapacitor()) {
    // On mobile, share the PDF — user can pick "Print" from the share sheet
    await sharePDFNative(blob, fileName, `Imprimer ${fileName}`)
    return
  }

  // Desktop: open in new tab and trigger browser print
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (win) {
    win.onload = () => { win.focus(); win.print() }
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * Download or share a CSV file.
 * On Capacitor: writes to cache + opens native share sheet.
 * On web: triggers a download via anchor click.
 */
export async function downloadOrShareCSV(csvContent: string, fileName: string): Promise<void> {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })

  if (isCapacitor()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const base64 = await blobToBase64(blob)
    const result = await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: Directory.Cache,
    })
    await Share.share({ title: fileName, url: result.uri, dialogTitle: fileName })
    return
  }

  // Web: anchor download
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
