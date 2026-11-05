// Fonctions réservées par formule : constantes de la RÈGLE UNIQUE (explications dans lib/saas/plan-features). Fichier
// sans aucun import, lu par le serveur (via plan-features) et par la page d'accueil (tableau « Comparer les formules »).

// long_reports = historique au-delà de 3 mois (nom gardé) ; unlimited_history = historique sans limite
export type PlanFeature = 'transfers' | 'po_email' | 'exports' | 'long_reports' | 'unlimited_history' | 'priority_support'
export const PLAN_FEATURES: PlanFeature[] = ['transfers', 'po_email', 'exports', 'long_reports', 'unlimited_history', 'priority_support']
export type FeatureMap = Record<PlanFeature, boolean>

/** Formule minimale de chaque fonction */
export const FEATURE_MIN_PLAN: Record<PlanFeature, 'pro' | 'business'> = {
  transfers: 'pro', po_email: 'pro', exports: 'pro', long_reports: 'pro', unlimited_history: 'business', priority_support: 'business',
}

/** Starter : 3 derniers mois (92 jours couvrent « Ce trimestre » et « Mois dernier ») ; Pro : 1 an (366 jours couvrent
 *  « Cette année » et les 12 mois du tableau de bord) ; +1 jour de marge pour les fuseaux horaires */
export const REPORT_FREE_DAYS = 92
export const PRO_HISTORY_DAYS = 366

/** Rang des formules (essai = Pro) */
export const PLAN_RANK: Record<string, number> = { starter: 1, trial: 2, pro: 2, business: 3 }
