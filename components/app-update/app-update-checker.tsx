'use client'

import { useEffect, useRef, useState } from 'react'
import { App } from '@capacitor/app'
import { AppUpdate, AppUpdateAvailability, AppUpdateResultCode, FlexibleUpdateInstallStatus } from '@capawesome/capacitor-app-update'
import { isCapacitor } from '@/lib/utils/native-share'
import { RefreshCw, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

// Mises à jour de l'app Android, comme le font les apps professionnelles :
// Google Play In-App Updates (Play est la source de vérité, rien à maintenir).
//  - Souple : bandeau discret « Nouvelle version disponible » ; Play télécharge
//    en arrière-plan (flux flexible) sans quitter l'app, puis « Redémarrer ».
//    « Plus tard » est mémorisé 24 h pour cette version.
//  - Obligatoire : version installée < MIN_ANDROID_VERSION_CODE (serveur) →
//    écran bloquant, flux Play immédiat, pas de « Plus tard ».
//  - Repli (APK antérieur au plugin, appareil sans services Google) :
//    LATEST_ANDROID_VERSION_CODE du serveur + fiche Play Store.
// Vérifié 3 s après le lancement, puis à chaque retour au premier plan.

const SNOOZE_KEY = 'app_update_snooze_v1'
const SNOOZE_MS = 24 * 60 * 60 * 1000

type Mode = 'none' | 'soft' | 'required'
type Phase = 'idle' | 'downloading' | 'ready'

interface Policy { min_version_code: number; latest_version_code: number; app_id: string; store_url: string }
const DEFAULT_POLICY: Policy = { min_version_code: 0, latest_version_code: 0, app_id: 'com.northcode.stockshop', store_url: 'https://play.google.com/store/apps/details?id=com.northcode.stockshop' }

function readSnooze(): { code: number; until: number } | null {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || 'null') } catch { return null }
}

export function AppUpdateChecker() {
  const t = useTranslations('banners.app_update')
  const [mode, setMode] = useState<Mode>('none')
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState(false)
  const policyRef = useRef<Policy>(DEFAULT_POLICY)
  const playRef = useRef<{ available: boolean; flexible: boolean; immediate: boolean }>({ available: false, flexible: false, immediate: false })
  const availableCodeRef = useRef(0)

  const openStore = async () => {
    try {
      await AppUpdate.openAppStore({ androidPackageName: policyRef.current.app_id })
    } catch {
      window.open(policyRef.current.store_url, '_system')
    }
  }

  const check = async () => {
    try {
      const info = await App.getInfo()
      const current = parseInt(info.build, 10) || 0
      try {
        const res = await fetch('/api/app-version', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (res.ok) policyRef.current = { ...DEFAULT_POLICY, ...(await res.json()) }
      } catch { /* hors ligne : la politique par défaut ne force rien */ }
      const policy = policyRef.current

      // Google Play d'abord (plugin présent à partir de la 2.19.0)
      let available = 0
      playRef.current = { available: false, flexible: false, immediate: false }
      try {
        const r = await AppUpdate.getAppUpdateInfo()
        if (r.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
          // Téléchargée lors d'une session précédente : il ne reste qu'à redémarrer
          setMode('soft'); setPhase('ready'); return
        }
        if (r.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE) {
          available = parseInt(r.availableVersionCode || '0', 10) || current + 1
          playRef.current = { available: true, flexible: !!r.flexibleUpdateAllowed, immediate: !!r.immediateUpdateAllowed }
        }
      } catch { /* plugin absent ou Play indisponible : repli serveur */ }
      if (!available && policy.latest_version_code > current) available = policy.latest_version_code
      availableCodeRef.current = available

      if (policy.min_version_code > 0 && current < policy.min_version_code) { setMode('required'); return }
      if (!available) { setMode('none'); return }
      const snooze = readSnooze()
      if (snooze && snooze.code === available && snooze.until > Date.now()) { setMode('none'); return }
      setMode('soft')
    } catch { /* silencieux : jamais bloquer la caisse pour une vérification */ }
  }

  useEffect(() => {
    if (!isCapacitor()) return
    const timer = setTimeout(check, 3000)
    const handles: Promise<{ remove: () => void }>[] = []
    handles.push(App.addListener('appStateChange', ({ isActive }) => { if (isActive) check() }))
    handles.push(AppUpdate.addListener('onFlexibleUpdateStateChange', (state) => {
      if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADING) {
        setPhase('downloading')
        if (state.totalBytesToDownload) setProgress(Math.round((state.bytesDownloaded || 0) / state.totalBytesToDownload * 100))
      } else if (state.installStatus === FlexibleUpdateInstallStatus.DOWNLOADED) {
        setPhase('ready'); setProgress(null)
      } else if (state.installStatus === FlexibleUpdateInstallStatus.FAILED || state.installStatus === FlexibleUpdateInstallStatus.CANCELED) {
        setPhase('idle'); setProgress(null)
      }
    }).catch(() => ({ remove: () => {} })))
    return () => {
      clearTimeout(timer)
      handles.forEach(h => h.then(x => x.remove()).catch(() => {}))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const later = () => {
    try { localStorage.setItem(SNOOZE_KEY, JSON.stringify({ code: availableCodeRef.current, until: Date.now() + SNOOZE_MS })) } catch { /* ignore */ }
    setMode('none')
  }

  const updateSoft = async () => {
    setError(false)
    if (playRef.current.available && playRef.current.flexible) {
      try {
        const r = await AppUpdate.startFlexibleUpdate()
        if (r.code === AppUpdateResultCode.OK) { setPhase('downloading'); return }
        if (r.code === AppUpdateResultCode.CANCELED) { later(); return }
      } catch { /* repli : fiche Play Store */ }
      setError(true)
    }
    openStore()
  }

  const updateRequired = async () => {
    setError(false)
    if (playRef.current.available && playRef.current.immediate) {
      try {
        const r = await AppUpdate.performImmediateUpdate()
        if (r.code === AppUpdateResultCode.OK || r.code === AppUpdateResultCode.CANCELED) return // l'écran reste tant que la version est trop ancienne
      } catch { /* repli : fiche Play Store */ }
      setError(true)
    }
    openStore()
  }

  const restart = () => { AppUpdate.completeFlexibleUpdate().catch(() => openStore()) }

  if (!isCapacitor() || mode === 'none') return null

  // ── Obligatoire : écran bloquant, sans « Plus tard » ──
  if (mode === 'required') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-card shadow-2xl">
          <div className="bg-stockshop-blue px-6 pb-5 pt-6">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/20">
              <RefreshCw className="h-7 w-7 text-white" />
            </div>
            <h2 className="text-center text-lg font-bold text-white">{t('title')}</h2>
            <p className="mt-1 text-center text-sm text-blue-200">{t('subtitle')}</p>
          </div>
          <div className="space-y-3 px-6 py-5">
            <p className="text-center text-sm text-muted-foreground">{t('required_body')}</p>
            {error && <p className="text-center text-xs text-red-500">{t('failed')}</p>}
            <Button className="h-11 w-full bg-stockshop-blue font-semibold text-white hover:bg-stockshop-blue-light dark:bg-blue-600 dark:hover:bg-blue-500" onClick={updateRequired}>
              {t('update_button')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Souple : carte flottante au-dessus de la barre du bas (téléphone), en bas à droite (PC) ──
  return (
    <div className="fixed inset-x-3 z-[60] bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-6 md:right-6 md:w-[22rem]">
      <div className="flex items-start gap-3 rounded-xl border border-stockshop-blue/20 bg-card p-3 shadow-lg">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">
          {phase === 'ready' ? <RefreshCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{phase === 'ready' ? t('ready') : phase === 'downloading' ? t('downloading') : t('available')}</p>
          {phase === 'idle' && <p className="text-xs text-muted-foreground">{t('available_hint')}</p>}
          {phase === 'downloading' && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-stockshop-blue transition-all" style={{ width: `${progress ?? 15}%` }} />
            </div>
          )}
          {error && <p className="mt-1 text-xs text-red-500">{t('failed')}</p>}
          <div className="mt-2 flex items-center gap-2">
            {phase === 'ready' ? (
              <Button size="sm" className="h-8 bg-stockshop-blue text-white hover:bg-stockshop-blue-light" onClick={restart}>{t('restart')}</Button>
            ) : phase === 'idle' ? (
              <>
                <Button size="sm" className="h-8 bg-stockshop-blue text-white hover:bg-stockshop-blue-light" onClick={updateSoft}>{t('update_button')}</Button>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={later}>{t('later')}</button>
              </>
            ) : null}
          </div>
        </div>
        {phase === 'idle' && (
          <button type="button" aria-label={t('later')} onClick={later} className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}
