// Fonctions réservées par formule (tarification du 3 nov. 2026) — RÈGLE UNIQUE, lue par le serveur (routes qui refusent)
// et par l'écran (cadenas « Pro » pour le propriétaire, fonction cachée pour les employés).
//
//   • Pro et plus : transferts entre boutiques, envoi des bons de commande par e-mail, exports Excel / CSV, rapports
//     sur plus de 3 mois ;
//   • Business : support prioritaire.
// Essai = limites et fonctions de Pro. Comptes internes : tout. Clients actuels (entities.legacy_terms) : tout reste
// comme avant tant que leurs anciennes conditions valent (même formule, avant `limits_until`), donc retrait seulement
// à leur prochain renouvellement. Rien n'est jamais effacé : l'historique reste lisible, un transfert en route se
// réceptionne, un bon de commande se crée et se télécharge.

import { getAccountForShop } from './entity'
import { getLegacyTerms, type LegacyTerms } from './legacy-terms'

export type PlanFeature = 'transfers' | 'po_email' | 'exports' | 'long_reports' | 'priority_support'
export const PLAN_FEATURES: PlanFeature[] = ['transfers', 'po_email', 'exports', 'long_reports', 'priority_support']
export type FeatureMap = Record<PlanFeature, boolean>

/** Formule minimale de chaque fonction */
export const FEATURE_MIN_PLAN: Record<PlanFeature, 'pro' | 'business'> = {
  transfers: 'pro', po_email: 'pro', exports: 'pro', long_reports: 'pro', priority_support: 'business',
}

/** Rapports sans formule Pro : 3 derniers mois (92 jours couvrent « Ce trimestre », +1 jour pour les fuseaux) */
export const REPORT_FREE_DAYS = 92
const DAY = 86_400_000
export function reportStartAllowed(start: Date | string, allowLong: boolean, now = new Date()): boolean {
  if (allowLong) return true
  const s = new Date(start).getTime()
  return Number.isFinite(s) && s >= now.getTime() - (REPORT_FREE_DAYS + 1) * DAY
}

const RANK: Record<string, number> = { starter: 1, trial: 2, pro: 2, business: 3 }

/** Anciennes conditions encore valables (même formule, avant la date) */
export function legacyActive(terms: LegacyTerms | null, planId: string | null | undefined, now = new Date()): boolean {
  return !!terms && terms.plan === planId && now < new Date(terms.limits_until)
}

export function featuresFor(
  account: { plan?: string | null; is_internal?: boolean } | null, terms: LegacyTerms | null, now = new Date(),
): FeatureMap {
  const plan = account?.plan || 'trial'
  const all = !!account?.is_internal || legacyActive(terms, plan, now)
  // Formule inconnue (ancienne valeur « free »…) : traitée comme l'essai
  const rank = RANK[plan] ?? RANK.trial
  const out = {} as FeatureMap
  for (const f of PLAN_FEATURES) out[f] = all || rank >= RANK[FEATURE_MIN_PLAN[f]]
  return out
}

/** Fonctions permises pour l'entreprise d'une boutique (client admin) */
export async function getShopFeatures(admin: any, shopId: string, now = new Date()): Promise<{ plan: string; features: FeatureMap }> {
  const account = await getAccountForShop(admin, shopId)
  const terms = account ? await getLegacyTerms(admin, account.entityId) : null
  return { plan: account?.plan || 'trial', features: featuresFor(account, terms, now) }
}

/** Refus commun : code stable que l'écran transforme en fenêtre « incluse dans la formule Pro » */
export function featureRefusal(feature: PlanFeature, message: string) {
  return { body: { error: message, code: 'plan_feature_required', feature, required_plan: FEATURE_MIN_PLAN[feature] }, status: 403 }
}

/** null si permis dans TOUTES les boutiques données, sinon le refus à renvoyer */
export async function requireFeature(admin: any, shopIds: string[], feature: PlanFeature, t: (k: any, p?: any) => string) {
  for (const id of Array.from(new Set(shopIds))) {
    const { features } = await getShopFeatures(admin, id)
    if (!features[feature]) return featureRefusal(feature, t('plan_feature_required', { plan: FEATURE_MIN_PLAN[feature] === 'business' ? 'Business' : 'Pro' }))
  }
  return null
}
