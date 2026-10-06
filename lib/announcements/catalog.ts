// Nouveautés — catalogue et validation PARTAGÉS par l'éditeur admin et la
// route serveur (/api/admin/announcements) : pages de l'app proposées pour
// le bandeau et le lien « Essayer », rôles ciblables, règles de saisie.
// Un chemin hors catalogue est refusé (pas de lien cassé, pas de faute de frappe).

import { TOUR_IDS, type TourId } from '@/lib/onboarding/tours'

export const ANNOUNCEMENT_PAGES: { path: string; label: string }[] = [
  { path: 'dashboard', label: 'Tableau de bord' },
  { path: 'sales/new', label: 'Nouvelle vente' },
  { path: 'sales/history', label: 'Historique des ventes' },
  { path: 'payments', label: 'Crédits' },
  { path: 'customers', label: 'Clients' },
  { path: 'stock', label: 'Stock — vue d’ensemble' },
  { path: 'stock/products', label: 'Stock — produits' },
  { path: 'stock/movements', label: 'Stock — mouvements' },
  { path: 'stock/expiry', label: 'Stock — lots et péremptions' },
  { path: 'stock/inventory-count', label: 'Stock — inventaires' },
  { path: 'stock/transfers', label: 'Stock — transferts' },
  { path: 'categories', label: 'Catégories' },
  { path: 'suppliers', label: 'Fournisseurs' },
  { path: 'caisse', label: 'Contrôle de caisse' },
  { path: 'reports', label: 'Rapports' },
  { path: 'notes', label: 'Notes' },
  { path: 'expenses', label: 'Dépenses' },
  { path: 'team', label: 'Équipe' },
  { path: 'shops', label: 'Boutiques' },
  { path: 'settings', label: 'Paramètres' },
  { path: 'billing', label: 'Abonnement' },
  { path: 'help', label: 'Aide' },
]
const PAGE_SET = new Set(ANNOUNCEMENT_PAGES.map(p => p.path))

export const ANNOUNCEMENT_ROLES: { role: string; label: string }[] = [
  { role: 'owner', label: 'Propriétaire' },
  { role: 'shop_manager', label: 'Manager' },
  { role: 'manager', label: 'Responsable' },
  { role: 'stock_manager', label: 'Gestionnaire de stock' },
  { role: 'cashier', label: 'Caissier' },
  { role: 'viewer', label: 'Observateur' },
]
const ROLE_SET = new Set(ANNOUNCEMENT_ROLES.map(r => r.role))

// Tours guidés qu'une nouveauté peut lancer (« Me montrer ») — migration 165.
// Le bouton n'est montré qu'à qui peut suivre le tour (use-available-tours).
export const ANNOUNCEMENT_TOURS: { tour: TourId; label: string }[] = [
  { tour: 'quick_tour', label: 'Visite express' },
  { tour: 'add_product', label: 'Ajouter un produit' },
  { tour: 'first_sale', label: 'Faire une vente' },
  { tour: 'add_category', label: 'Créer une catégorie' },
  { tour: 'invite_member', label: 'Inviter un membre (gestion d’équipe)' },
  { tour: 'customize_receipt', label: 'Personnaliser le reçu (propriétaire)' },
]

export const ANNOUNCEMENT_KINDS = [
  { kind: 'new', label: 'Nouveau', badge: 'Nouveau', color: 'blue' },
  { kind: 'improvement', label: 'Amélioration', badge: 'Amélioration', color: 'green' },
  { kind: 'fix', label: 'Correction', badge: 'Correction', color: 'amber' },
] as const
export type AnnouncementKindValue = typeof ANNOUNCEMENT_KINDS[number]['kind']

export const TITLE_MAX = 80
export const DESCRIPTION_MAX = 300

export interface AnnouncementInput {
  kind: AnnouncementKindValue
  title: string
  description: string
  title_en: string | null
  description_en: string | null
  title_ha: string | null
  description_ha: string | null
  target_path: string | null
  cta_path: string | null
  tour_id: TourId | null
  roles: string[] | null
  published_at: string
  expires_at: string | null
  is_active: boolean
}

export type AnnouncementStatus = 'draft' | 'scheduled' | 'live' | 'ended'

/** État affiché : brouillon (non activée), programmée, en ligne, terminée */
export function announcementStatus(a: { is_active: boolean; published_at: string; expires_at: string | null }, now = Date.now()): AnnouncementStatus {
  if (!a.is_active) return 'draft'
  if (a.expires_at && new Date(a.expires_at).getTime() <= now) return 'ended'
  if (new Date(a.published_at).getTime() > now) return 'scheduled'
  return 'live'
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const optional = (v: unknown) => text(v) || null

/** Valide et normalise une saisie ; renvoie la liste des erreurs (en français, outil interne) */
export function validateAnnouncement(raw: any): { value?: AnnouncementInput; errors: string[] } {
  const errors: string[] = []
  const kind = ANNOUNCEMENT_KINDS.some(k => k.kind === raw?.kind) ? raw.kind : null
  if (!kind) errors.push('Type invalide.')
  const value: AnnouncementInput = {
    kind: kind ?? 'new',
    title: text(raw?.title),
    description: text(raw?.description),
    title_en: optional(raw?.title_en),
    description_en: optional(raw?.description_en),
    title_ha: optional(raw?.title_ha),
    description_ha: optional(raw?.description_ha),
    target_path: optional(raw?.target_path),
    cta_path: optional(raw?.cta_path),
    tour_id: optional(raw?.tour_id) as TourId | null,
    roles: Array.isArray(raw?.roles) && raw.roles.length ? Array.from(new Set(raw.roles.map(String))) : null,
    published_at: text(raw?.published_at) || new Date().toISOString(),
    expires_at: optional(raw?.expires_at),
    is_active: raw?.is_active !== false,
  }
  if (value.title.length < 3 || value.title.length > TITLE_MAX) errors.push(`Titre en français : 3 à ${TITLE_MAX} caractères.`)
  if (value.description.length < 10 || value.description.length > DESCRIPTION_MAX) errors.push(`Texte en français : 10 à ${DESCRIPTION_MAX} caractères.`)
  for (const [lang, t, d] of [['anglais', value.title_en, value.description_en], ['haoussa', value.title_ha, value.description_ha]] as const) {
    if (!!t !== !!d) errors.push(`Version ${lang} : titre et texte vont ensemble (ou les deux vides).`)
    if (t && t.length > TITLE_MAX) errors.push(`Titre en ${lang} : ${TITLE_MAX} caractères au plus.`)
    if (d && d.length > DESCRIPTION_MAX) errors.push(`Texte en ${lang} : ${DESCRIPTION_MAX} caractères au plus.`)
  }
  if (value.target_path && !PAGE_SET.has(value.target_path)) errors.push('Page concernée inconnue.')
  if (value.cta_path && !PAGE_SET.has(value.cta_path)) errors.push('Page du lien « Essayer » inconnue.')
  if (value.tour_id && !TOUR_IDS.includes(value.tour_id)) errors.push('Tour guidé inconnu.')
  if (value.roles?.some(r => !ROLE_SET.has(r))) errors.push('Rôle inconnu dans le public.')
  if (value.roles && value.roles.length === ROLE_SET.size) value.roles = null // tout le monde
  const pub = new Date(value.published_at)
  if (Number.isNaN(pub.getTime())) errors.push('Date de publication invalide.')
  else value.published_at = pub.toISOString()
  if (value.expires_at) {
    const exp = new Date(value.expires_at)
    if (Number.isNaN(exp.getTime())) errors.push('Date de fin invalide.')
    else if (!Number.isNaN(pub.getTime()) && exp <= pub) errors.push('La date de fin doit suivre la date de publication.')
    else value.expires_at = exp.toISOString()
  }
  return errors.length ? { errors } : { value, errors }
}
