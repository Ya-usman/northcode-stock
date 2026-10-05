'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { getPendingCount, getPendingMovementCount, getPendingExpenseCount, getPendingCustomerPaymentCount, getPendingSupplierPaymentCount } from './db'
import { syncAllPending, type SyncResult } from './sync'
import { isCapacitor } from '@/lib/utils/native-share'

// ── Moniteur de connexion partagé ──────────────────────────────────────────
// navigator.onLine n'est pas fiable dans la WebView Android : seule une vraie
// requête fait foi. UN moniteur pour toute l'app (une trentaine de composants
// montent useOffline() : avant, chacun sondait de son côté avec son propre
// état, et un seul échec de 4 s passait tout l'écran en « hors ligne » pour
// 30 s — typiquement au retour au premier plan, le temps que la radio se
// réveille). Règles :
//   - en ligne dès le PREMIER succès ;
//   - hors ligne seulement après DEUX échecs consécutifs (contre-sonde 3 s
//     après le premier), sauf si le système dit « aucun réseau »
//     (navigator.onLine === false, fiable dans ce sens) : immédiat ;
//   - sonde à 8 s (réseau mobile lent ≠ coupure) ;
//   - revérification immédiate au retour au premier plan (Capacitor resume,
//     onglet visible, focus, pageshow, événement online), puis toutes les
//     10 s hors ligne et 60 s en ligne.
const PROBE_TIMEOUT_MS = 8_000
const FAILURES_TO_GO_OFFLINE = 2
const RETRY_AFTER_FIRST_FAILURE_MS = 3_000
const RECHECK_OFFLINE_MS = 10_000
const RECHECK_ONLINE_MS = 60_000

type Listener = () => void
const monitor = {
  online: true,
  failures: 0,
  started: false,
  probing: null as Promise<boolean> | null,
  timer: null as ReturnType<typeof setTimeout> | null,
  listeners: new Set<Listener>(),
}

function emit() { monitor.listeners.forEach(l => l()) }
/** Dernier déclenchement de la synchro automatique à l'ouverture / au premier plan (anti-rafale) */
let lastAutoSyncKick = 0
function setOnline(value: boolean) {
  if (monitor.online === value) return
  monitor.online = value
  emit()
}

async function probeOnce(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

function schedule() {
  if (monitor.timer) clearTimeout(monitor.timer)
  const delay = !monitor.online ? RECHECK_OFFLINE_MS
    : monitor.failures > 0 ? RETRY_AFTER_FIRST_FAILURE_MS
    : RECHECK_ONLINE_MS
  monitor.timer = setTimeout(() => { checkConnectivity() }, delay)
}

/** Sonde la connexion (une seule à la fois) et applique l'hystérésis ; renvoie l'état résultant. */
export async function checkConnectivity(): Promise<boolean> {
  if (monitor.probing) return monitor.probing
  monitor.probing = (async () => {
    const ok = await probeOnce()
    if (ok) {
      monitor.failures = 0
      setOnline(true)
    } else {
      monitor.failures += 1
      const noNetwork = typeof navigator !== 'undefined' && navigator.onLine === false
      if (noNetwork || monitor.failures >= FAILURES_TO_GO_OFFLINE) setOnline(false)
    }
    schedule()
    return monitor.online
  })()
  try { return await monitor.probing } finally { monitor.probing = null }
}

/** État courant sans sonder (pour du code hors React). */
export function isCurrentlyOnline(): boolean { return monitor.online }

function startMonitor() {
  if (monitor.started || typeof window === 'undefined') return
  monitor.started = true
  const recheck = () => { checkConnectivity() }
  window.addEventListener('online', recheck)
  window.addEventListener('offline', () => {
    // « Aucun réseau » côté système : hors ligne tout de suite, contre-sonde rapide ensuite
    monitor.failures = FAILURES_TO_GO_OFFLINE
    setOnline(false)
    if (monitor.timer) clearTimeout(monitor.timer)
    monitor.timer = setTimeout(recheck, RETRY_AFTER_FIRST_FAILURE_MS)
  })
  window.addEventListener('focus', recheck)
  window.addEventListener('pageshow', recheck)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') recheck() })
  if (isCapacitor()) {
    // Retour au premier plan de l'app Android : la radio se réveille, on revérifie
    import('@capacitor/app')
      .then(({ App }) => { App.addListener('appStateChange', ({ isActive }) => { if (isActive) recheck() }) })
      .catch(() => { /* plugin absent : les événements du navigateur suffisent */ })
  }
  checkConnectivity()
}

function subscribe(listener: Listener) {
  monitor.listeners.add(listener)
  startMonitor()
  return () => { monitor.listeners.delete(listener) }
}
const getSnapshot = () => monitor.online
const getServerSnapshot = () => true // SSR : en ligne (évite un bandeau rouge au premier rendu)

export function useOffline() {
  const { shop } = useAuth()
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncResult, setLastSyncResult] = useState<SyncResult | null>(null)
  const shopId = shop?.id
  const pendingCountRef = useRef(0)
  const wasOfflineRef = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    if (!shopId) return
    const [sales, movements, expenses, customerPayments, supplierPayments] = await Promise.all([
      getPendingCount(shopId),
      getPendingMovementCount(shopId),
      getPendingExpenseCount(shopId),
      getPendingCustomerPaymentCount(shopId),
      getPendingSupplierPaymentCount(shopId),
    ])
    const total = sales + movements + expenses + customerPayments + supplierPayments
    setPendingCount(total)
    pendingCountRef.current = total
  }, [shopId])

  const sync = useCallback(async (): Promise<SyncResult | null> => {
    if (!shopId) return null
    setSyncing(true)
    try {
      // syncAllPending() is shared process-wide — concurrent callers (this hook
      // is mounted independently in several components at once) join the same
      // in-flight sync instead of each starting their own pass over the same
      // pending queue, which used to insert offline sales more than once.
      const combined = await syncAllPending(shopId)
      setLastSyncResult(combined)
      await refreshPendingCount()
      return combined
    } finally {
      setSyncing(false)
    }
  }, [shopId, refreshPendingCount])

  // Retour en ligne confirmé avec des opérations en attente → synchronisation
  useEffect(() => {
    if (isOnline && wasOfflineRef.current && pendingCountRef.current > 0) sync()
    wasOfflineRef.current = !isOnline
  }, [isOnline, sync])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // Opérations en attente restées en file (sync ratée, app rouverte) : nouvel essai toutes les 30 s
    const interval = setInterval(() => { if (monitor.online && pendingCountRef.current > 0) sync() }, 30_000)
    // Background Sync du service worker
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'BACKGROUND_SYNC_SALES') sync()
    }
    navigator.serviceWorker?.addEventListener('message', handleMessage)
    return () => {
      clearInterval(interval)
      navigator.serviceWorker?.removeEventListener('message', handleMessage)
    }
  }, [sync])

  useEffect(() => {
    refreshPendingCount()
  }, [refreshPendingCount])

  // Ouverture de l'app et retour au premier plan : s'il reste des opérations
  // en file et que le réseau est là, on synchronise TOUT DE SUITE — sans
  // attendre la boucle de 30 s ni un appui sur « Synchroniser » (cas typique :
  // Android a fermé l'app pendant l'envoi du reçu sur WhatsApp). Une seule
  // fois pour toute l'app malgré la trentaine de composants qui montent ce hook.
  useEffect(() => {
    if (typeof window === 'undefined' || !shopId) return
    const kick = async () => {
      const now = Date.now()
      if (now - lastAutoSyncKick < 5_000) return
      lastAutoSyncKick = now
      await refreshPendingCount()
      if (pendingCountRef.current > 0 && (await checkConnectivity())) sync()
    }
    kick()
    const onVisible = () => { if (document.visibilityState === 'visible') kick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [shopId]) // eslint-disable-line react-hooks/exhaustive-deps

  return { isOnline, pendingCount, syncing, sync, refreshPendingCount, lastSyncResult }
}
