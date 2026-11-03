'use client'

// Fonctions réservées par formule, à l'écran (règle unique : lib/saas/plan-features, appliquée par le serveur) :
//   • propriétaire : la fonction reste à sa place avec un cadenas et l'étiquette « Pro » ; un appui ouvre une courte
//     fenêtre avec le lien vers l'abonnement ;
//   • employés : la fonction est cachée (ils ne peuvent pas payer) ;
//   • pendant l'essai : la fonction marche, avec une étiquette « Pro » discrète, pour éviter toute surprise.
// Tant que la réponse du serveur n'est pas arrivée, rien n'est verrouillé (le serveur refuse de toute façon).

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'
import { useAuth } from '@/lib/hooks/use-auth'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { cn } from '@/lib/utils/cn'
import type { FeatureMap, PlanFeature } from '@/lib/saas/plan-features'

type Info = { plan: string; features: FeatureMap; required: Record<PlanFeature, 'pro' | 'business'> }
const cache = new Map<string, Info>()
const pending = new Map<string, Promise<Info | null>>()

function load(shopId: string): Promise<Info | null> {
  if (cache.has(shopId)) return Promise.resolve(cache.get(shopId)!)
  if (!pending.has(shopId)) {
    pending.set(shopId, fetch(`/api/billing/features?shop_id=${shopId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.features) cache.set(shopId, j); return j?.features ? j : null })
      .catch(() => null)
      .finally(() => pending.delete(shopId)))
  }
  return pending.get(shopId)!
}

/** Formule et fonctions permises pour la boutique active (null tant que non connues) */
export function usePlanFeatures(): Info | null {
  const { shop } = useAuth()
  const id = shop?.id
  const [info, setInfo] = React.useState<Info | null>(() => (id ? cache.get(id) ?? null : null))
  React.useEffect(() => {
    let alive = true
    setInfo(id ? cache.get(id) ?? null : null)
    if (id) load(id).then(i => { if (alive) setInfo(i) })
    return () => { alive = false }
  }, [id])
  return info
}

/** Après un paiement ou un changement de formule : relire au prochain affichage */
export function clearPlanFeaturesCache() { cache.clear() }

export type FeatureLockState = 'ok' | 'trial' | 'locked' | 'hidden'

function useIsOwner(): boolean {
  const { roleInActiveShop, profile } = useAuth()
  const role = roleInActiveShop ?? profile?.role
  return role === 'owner' || role === 'super_admin'
}

/** ok : permis · trial : permis pendant l'essai (étiquette discrète) · locked : cadenas (propriétaire) · hidden : caché */
export function useFeatureLock(feature: PlanFeature): FeatureLockState {
  const info = usePlanFeatures()
  const owner = useIsOwner()
  if (!info) return 'ok'
  if (info.features[feature]) return info.plan === 'trial' && owner ? 'trial' : 'ok'
  return owner ? 'locked' : 'hidden'
}

const EVENT = 'stockshop:plan-lock'

/** Ouvre la fenêtre « fonction incluse dans la formule … » */
export function openPlanLock(feature: PlanFeature) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: feature }))
}

/** Réponse d'une route refusée pour la formule : ouvre la fenêtre et renvoie true */
export function handlePlanRefusal(json: any): boolean {
  if (json?.code !== 'plan_feature_required' || !json?.feature) return false
  openPlanLock(json.feature as PlanFeature)
  return true
}

/** Étiquette « Pro » (avec cadenas quand la fonction est verrouillée) */
export function PlanBadge({ state, feature, className }: { state: FeatureLockState; feature: PlanFeature; className?: string }) {
  const info = usePlanFeatures()
  if (state !== 'locked' && state !== 'trial') return null
  const plan = (info?.required[feature] ?? 'pro') === 'business' ? 'Business' : 'Pro'
  return (
    <span
      className={cn(
        'ml-auto inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none',
        state === 'locked'
          ? 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950 dark:text-blue-300'
          : 'border border-stockshop-blue/30 text-stockshop-blue dark:border-blue-400/40 dark:text-blue-300',
        className,
      )}
      data-testid={`plan-badge-${feature}`}
      data-state={state}
    >
      {state === 'locked' && <Lock className="h-2.5 w-2.5" aria-hidden />}
      {plan}
    </span>
  )
}

/** Fenêtre unique, montée une fois dans la mise en page de l'application */
export function PlanLockDialog() {
  const t = useTranslations('plan_lock')
  const locale = useLocale()
  const router = useRouter()
  const info = usePlanFeatures()
  const owner = useIsOwner()
  const [feature, setFeature] = React.useState<PlanFeature | null>(null)
  React.useEffect(() => {
    const on = (e: Event) => setFeature((e as CustomEvent).detail as PlanFeature)
    window.addEventListener(EVENT, on)
    return () => window.removeEventListener(EVENT, on)
  }, [])
  const plan = feature && (info?.required[feature] ?? 'pro') === 'business' ? 'Business' : 'Pro'
  const close = () => setFeature(null)
  return (
    <PremiumDialog open={!!feature} onOpenChange={o => { if (!o) close() }} title={t('title', { plan })} icon={<Lock className="h-4 w-4" />} centered testId="plan-lock-dialog">
      <PremiumDialogBody>
        {feature && <p className="text-sm text-foreground/80">{t(`features.${feature}`, { plan })}</p>}
        {!owner && <p className="text-sm text-muted-foreground">{t('ask_owner')}</p>}
      </PremiumDialogBody>
      <PremiumDialogFooter
        onCancel={close}
        cancelLabel={t('close')}
        // Navigation après le retrait de l'étape d'historique de la fenêtre (modal-stack), sinon le retour l'annule
        onConfirm={owner ? () => { close(); window.setTimeout(() => router.push(`/${locale}/billing`), 350) } : undefined}
        confirmLabel={t('see_plans')}
      />
    </PremiumDialog>
  )
}
