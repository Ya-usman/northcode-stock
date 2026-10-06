'use client'

// Enregistrer un fichier produit par l'app (export Excel/CSV, modèle d'import,
// PDF de rapport…) — 7 oct. 2026. Un bouton « Télécharger » ENREGISTRE ; le
// partage reste un choix (bouton « Partager » du message), jamais imposé :
//  · application Android : Documents › StockShop (visible dans « Fichiers »),
//    sans écraser un fichier du même nom (« … (2).xlsx ») ; si le téléphone
//    refuse (Android 10 et moins sans l'autorisation, en attendant la version
//    de l'app qui la demande), repli sur la feuille de partage, expliqué ;
//  · navigateur (téléphone ou ordinateur) : vrai téléchargement (dossier
//    Téléchargements) ; iPhone en application installée : lien temporaire
//    (seul moyen fiable d'y télécharger).
// Les boutons dont le rôle EST de partager (reçu, WhatsApp, impression sur
// téléphone) gardent sharePDFNative / printPDFNative.

import * as React from 'react'
import { toast } from '@/components/ui/use-toast'
import { ToastAction } from '@/components/ui/toast'

export const DEVICE_FOLDER = 'StockShop'

type Lang = 'fr' | 'en' | 'ha'
const TEXT: Record<Lang, { saved: string; where: string; share: string; fallback: string }> = {
  fr: { saved: 'Fichier enregistré', where: 'Documents › StockShop › {name}', share: 'Partager', fallback: 'Ce téléphone n’autorise pas l’enregistrement direct : choisissez « Enregistrer » ou une application dans la liste.' },
  en: { saved: 'File saved', where: 'Documents › StockShop › {name}', share: 'Share', fallback: 'This phone does not allow saving directly: choose “Save” or an app from the list.' },
  // Haoussa : à relire
  ha: { saved: 'An ajiye fayil', where: 'Documents › StockShop › {name}', share: 'Raba', fallback: 'Wannan waya ba ta ba da damar ajiyewa kai tsaye ba: zaɓi “Ajiye” ko wata manhaja a jerin.' },
}
const lang = (): Lang => {
  const seg = typeof window !== 'undefined' ? window.location.pathname.split('/')[1] : ''
  return seg === 'en' || seg === 'ha' ? seg : 'fr'
}

const isCapacitor = () => typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.()
const safeName = (name: string) => name.replace(/[/\\:*?"<>|]/g, '-').trim()

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1])
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export type SaveResult =
  | { kind: 'device'; uri: string; fileName: string }
  | { kind: 'download' }
  | { kind: 'shared' }

/** Partage d'un fichier déjà écrit (bouton « Partager » du message, repli) */
async function shareUri(uri: string, title: string) {
  const { Share } = await import('@capacitor/share')
  try { await Share.share({ title, url: uri, dialogTitle: title }) } catch { /* fermé par la personne */ }
}

/** « Rapport.pdf » libre ? sinon « Rapport (2).pdf », « Rapport (3).pdf »… */
async function freeName(Filesystem: any, Directory: any, name: string): Promise<string> {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${base} (${n})${ext}`
    try { await Filesystem.stat({ path: `${DEVICE_FOLDER}/${candidate}`, directory: Directory.Documents }) }
    catch { return candidate } // n'existe pas
  }
  return `${base} (${Date.now()})${ext}`
}

async function saveOnDevice(blob: Blob, fileName: string): Promise<SaveResult> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const data = await blobToBase64(blob)
  const name = safeName(fileName)
  const write = async () => {
    const finalName = await freeName(Filesystem, Directory, name)
    const res = await Filesystem.writeFile({ path: `${DEVICE_FOLDER}/${finalName}`, data, directory: Directory.Documents, recursive: true })
    return { uri: res.uri, fileName: finalName }
  }
  try {
    let saved: { uri: string; fileName: string }
    try { saved = await write() }
    catch {
      // Android 10 et moins : autorisation de stockage à demander, puis nouvel essai
      const perm = await Filesystem.requestPermissions().catch(() => null)
      if (perm?.publicStorage !== 'granted') throw new Error('no-permission')
      saved = await write()
    }
    const tx = TEXT[lang()]
    toast({
      title: tx.saved,
      description: tx.where.replace('{name}', saved.fileName),
      variant: 'success',
      action: <ToastAction altText={tx.share} onClick={() => shareUri(saved.uri, saved.fileName)}>{tx.share}</ToastAction>,
    })
    return { kind: 'device', ...saved }
  } catch {
    // Repli : fichier temporaire + feuille de partage (où « Enregistrer » est proposé)
    const tmp = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache })
    toast({ title: TEXT[lang()].fallback })
    await shareUri(tmp.uri, name)
    return { kind: 'shared' }
  }
}

function isIOSStandalone(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true)
}

export async function saveFile(blob: Blob, fileName: string): Promise<SaveResult> {
  if (isCapacitor()) return saveOnDevice(blob, fileName)

  // iPhone, application installée sur l'écran d'accueil : un lien blob n'y
  // télécharge rien → lien temporaire servi par le serveur (comme avant)
  if (isIOSStandalone()) {
    if (!navigator.onLine) { const err = new Error('OFFLINE'); err.name = 'OfflineError'; throw err }
    const resp = await fetch('/api/pdf-download', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: await blobToBase64(blob), filename: fileName, contentType: blob.type || 'application/octet-stream' }),
    })
    const json = await resp.json()
    if (json.error) throw new Error(json.error)
    window.location.href = json.url
    return { kind: 'download' }
  }

  // Navigateur (téléphone ou ordinateur) : téléchargement classique → Téléchargements
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName(fileName)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { kind: 'download' }
}
