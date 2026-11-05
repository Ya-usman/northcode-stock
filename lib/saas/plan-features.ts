// Fonctions réservées par formule (tarification du 3 nov. 2026) — RÈGLE UNIQUE, lue par le serveur (routes qui refusent)
// et par l'écran (cadenas « Pro » pour le propriétaire, fonction cachée pour les employés).
//
//   • Pro et plus : transferts entre boutiques, envoi des bons de commande par e-mail, exports Excel / CSV, historique
//     sur 1 an (au lieu de 3 mois) ;
//   • Business : historique sans limite, support prioritaire.
// Historique (choix du 3 nov. 2026, comme la page Abonnement) : ce qui sert à CONSULTER LE PASSÉ (historique des ventes,
// rapports, tableau de bord, caisse des jours passés, dépenses, mouvements de stock) est limité à 3 mois en Starter et
// 1 an en Pro. Jamais limité : ce qui est encore ouvert (crédits non soldés, dettes fournisseurs, stock et lots, bons
// et transferts en cours, historique d'un client dans Crédits) et le reçu public par lien ou QR.
// Essai = limites et fonctions de Pro. Comptes internes : tout. Clients actuels (entities.legacy_terms) : tout reste
// comme avant tant que leurs anciennes conditions valent (même formule, avant `limits_until`), donc retrait seulement
// à leur prochain renouvellement. Rien n'est jamais effacé : l'historique reste lisible, un transfert en route se
// réceptionne, un bon de commande se crée et se télécharge.

import { getAccountForShop } from './entity'
import { getLegacyTerms, parseLegacyTerms, type LegacyTerms } from './legacy-terms'

// Constantes de la règle (fonctions, formule minimale, durées d'historique, rang) : lib/saas/plan-feature-rules, sans
// import serveur, pour que la page d'accueil (tableau des formules) lise la même règle
import { PLAN_FEATURES, FEATURE_MIN_PLAN, REPORT_FREE_DAYS, PRO_HISTORY_DAYS, PLAN_RANK, type PlanFeature, type FeatureMap } from './plan-feature-rules'
export { PLAN_FEATURES, FEATURE_MIN_PLAN, REPORT_FREE_DAYS, PRO_HISTORY_DAYS, type PlanFeature, type FeatureMap }
const DAY = 86_400_000

/** Durée d'historique consultable en jours ; -1 = sans limite */
export function historyDays(features: Pick<FeatureMap, 'long_reports' | 'unlimited_history'>): number {
  return features.unlimited_history ? -1 : features.long_reports ? PRO_HISTORY_DAYS : REPORT_FREE_DAYS
}
/** Instant le plus ancien consultable (null = sans limite) */
export function historyFloor(days: number, now = new Date()): Date | null {
  return days < 0 ? null : new Date(now.getTime() - (days + 1) * DAY)
}
/** Début de période permis pour cette durée */
export function historyStartAllowed(start: Date | string, days: number, now = new Date()): boolean {
  const floor = historyFloor(days, now)
  if (!floor) return true
  const s = new Date(start).getTime()
  return Number.isFinite(s) && s >= floor.getTime()
}
/** Ramène un début de période (absent = depuis toujours) à la durée permise. Permis : rendu TEL QUEL (même fuseau,
 *  les dépenses se lisent sur ses 10 premiers caractères) ; sinon la limite, en ISO */
export function clampStart(start: string | null | undefined, days: number, now = new Date()): string | null {
  const floor = historyFloor(days, now)
  if (!floor) return start || null
  const s = start ? new Date(start).getTime() : NaN
  return Number.isFinite(s) && s >= floor.getTime() ? (start as string) : floor.toISOString()
}
/** Ancienne règle des rapports (3 mois sans Pro), gardée pour les appels existants */
export function reportStartAllowed(start: Date | string, allowLong: boolean, now = new Date()): boolean {
  return historyStartAllowed(start, allowLong ? -1 : REPORT_FREE_DAYS, now)
}

const RANK = PLAN_RANK

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
export async function getShopFeatures(admin: any, shopId: string, now = new Date()): Promise<{ plan: string; features: FeatureMap; historyDays: number }> {
  const account = await getAccountForShop(admin, shopId)
  const terms = account ? await getLegacyTerms(admin, account.entityId) : null
  const features = featuresFor(account, terms, now)
  return { plan: account?.plan || 'trial', features, historyDays: historyDays(features) }
}

/** Durée d'historique la plus courte parmi des boutiques (une vue sur plusieurs boutiques suit la plus limitée) ;
 *  deux lectures quel que soit le nombre de boutiques. Lecture impossible : pas de limite (affichage seulement, la base
 *  garde sa propre règle). */
export async function historyDaysFor(admin: any, shopIds: string[], now = new Date()): Promise<number> {
  const ids = Array.from(new Set(shopIds.filter(Boolean)))
  if (!ids.length) return -1
  const { data: shops, error } = await admin.from('shops').select('id, entity_id').in('id', ids)
  if (error) return -1
  const entityIds = Array.from(new Set((shops || []).map((x: any) => x.entity_id).filter(Boolean))) as string[]
  const accounts: any[] = []
  if (entityIds.length) {
    const { data: ents, error: e2 } = await admin.from('entities').select('id, plan, is_internal, legacy_terms').in('id', entityIds)
    if (e2) return -1
    accounts.push(...(ents || []))
  }
  // Boutique sans entreprise retrouvée : traitée comme l'essai
  if ((shops || []).some((x: any) => !x.entity_id || !accounts.some(a => a.id === x.entity_id))) accounts.push(null)
  let min = -1
  for (const a of accounts) {
    const d = historyDays(featuresFor(a ? { plan: a.plan || 'trial', is_internal: !!a.is_internal } : null, a ? parseLegacyTerms(a.legacy_terms) : null, now))
    if (d >= 0 && (min < 0 || d < min)) min = d
  }
  return min
}

/** Fonction à proposer quand le passé demandé dépasse la durée : Pro depuis Starter, Business depuis Pro */
export function historyFeature(days: number): PlanFeature {
  return days >= 0 && days <= REPORT_FREE_DAYS ? 'long_reports' : 'unlimited_history'
}
/** Refus « historique » : même code que les autres fonctions réservées, formule suivante annoncée */
export function historyRefusal(days: number, t: (k: any, p?: any) => string) {
  const f = historyFeature(days)
  return featureRefusal(f, t('plan_feature_required', { plan: FEATURE_MIN_PLAN[f] === 'business' ? 'Business' : 'Pro' }))
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
