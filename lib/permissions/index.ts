// Permissions par rôle — RÈGLE UNIQUE (lot 1 de la refonte du 5 oct. 2026).
//
// Partagée telle quelle par l'interface (lib/hooks/use-role-permissions.ts)
// et par le serveur (lib/api/role-permissions.ts) : aucune autre copie des
// valeurs par défaut, nulle part. Module pur (pas de React, pas de Supabase).
//
// Deux niveaux par fonction qui a une page :
//   « voir » (clé `<fonction>`)         → la page et ses listes
//   « modifier » (clé `<fonction>_write`) → créer, modifier, supprimer
// Les actions (nouvelle vente, inventaire…) et les cartes restent des
// interrupteurs. Réglages d'une boutique : shops.role_permissions (JSON), un
// objet par rôle + « general » (fonction masquée pour tout le monde).
//
// Règles fixes, indépendantes des réglages :
//   - super_admin : tout ; propriétaire : tout ce qui n'est pas masqué en général
//   - Observateur (viewer) : JAMAIS de modification, quel que soit le réglage
//   - rôle inconnu : rien

export type ConfigurableRole = 'manager' | 'shop_manager' | 'cashier' | 'viewer' | 'stock_manager'

/** Fonctions à trois niveaux : masqué · lecture · modification */
export const LEVEL_FEATURES = [
  'sales_history', 'payments', 'customers', 'stock', 'movements',
  'categories', 'suppliers', 'transfers', 'expenses',
] as const
export type LevelFeature = typeof LEVEL_FEATURES[number]

/** Actions et pages en lecture seule par nature : interrupteur simple */
export const SWITCH_FEATURES = [
  'new_sale', 'discount', 'reports', 'expiry_list', 'revenue_chart', 'notes',
  'delete_products', 'delete_expenses', 'caisse', 'inventory_count', 'extend_hours',
] as const
export type SwitchFeature = typeof SWITCH_FEATURES[number]

export const WIDGET_FEATURES = [
  'widget_today_revenue', 'widget_sales_count', 'widget_stock_alerts_card',
  'widget_outstanding_debt', 'widget_net_result', 'widget_stock_alerts_list',
  'widget_dashboard_revenue_chart', 'widget_top_products_chart', 'widget_recent_sales',
  'widget_rep_encaisse', 'widget_rep_depenses', 'widget_rep_transactions',
  'widget_rep_marge_brute', 'widget_rep_benefice_net', 'widget_rep_credits',
  'widget_rep_payment_chart', 'widget_rep_top_products', 'widget_rep_cashier_perf',
] as const
export type WidgetFeature = typeof WIDGET_FEATURES[number]

export type PermFeature = LevelFeature | SwitchFeature | WidgetFeature
export type WriteKey = `${LevelFeature}_write`
export type PermKey = PermFeature | WriteKey
export type RolePerms = Record<PermKey, boolean>
export type AllPerms = Record<ConfigurableRole, RolePerms>
/** Forme stockée (shops.role_permissions) : partielle, valeurs anciennes incluses */
export type StoredPermissions = Partial<Record<ConfigurableRole, Partial<RolePerms>>> & { general?: Partial<Record<PermFeature, boolean>> }
export type Level = 'hidden' | 'read' | 'write'

export const CONFIGURABLE_ROLES: ConfigurableRole[] = ['shop_manager', 'manager', 'cashier', 'viewer', 'stock_manager']

/** Rôles de direction : actions financières sensibles (annuler un paiement, passer une dette en perte, modifier une vente, fusionner des clients) */
export const MANAGERIAL_ROLES = ['owner', 'super_admin', 'shop_manager', 'manager'] as const
export function isManagerial(role: string | null | undefined): boolean {
  return !!role && (MANAGERIAL_ROLES as readonly string[]).includes(role)
}

export function isLevelFeature(f: string): f is LevelFeature {
  return (LEVEL_FEATURES as readonly string[]).includes(f)
}

/** Actions d'écriture à interrupteur : jamais ouvertes à l'Observateur, quel que soit le réglage */
export const VIEWER_LOCKED: readonly SwitchFeature[] = ['new_sale', 'discount', 'delete_products', 'delete_expenses', 'inventory_count', 'extend_hours', 'caisse']
export function isViewerLocked(f: string): boolean {
  return (VIEWER_LOCKED as readonly string[]).includes(f)
}
export const writeKey = (f: LevelFeature): WriteKey => `${f}_write`

// ── Valeurs par défaut ──────────────────────────────────────────────────────
// Lecture : inchangée par rapport aux réglages historiques. Modification :
// comportement réel d'avant le lot 1 pour Manager, Responsable et
// Gestionnaire de stock ; Caissier = ce qu'il fait en caisse (clients,
// encaissements) ; Observateur = rien (forcé dans resolvePermission).
const W = (on: LevelFeature[]): Record<WriteKey, boolean> =>
  Object.fromEntries(LEVEL_FEATURES.map(f => [writeKey(f), on.includes(f)])) as Record<WriteKey, boolean>

const ALL_WIDGETS_ON = Object.fromEntries(WIDGET_FEATURES.map(k => [k, true])) as Record<WidgetFeature, boolean>

const MANAGER_BASE: RolePerms = {
  new_sale: true, discount: true, sales_history: true, payments: true, customers: true,
  stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
  reports: true, revenue_chart: false, notes: true, expenses: true,
  delete_products: false, delete_expenses: true, caisse: true, inventory_count: true, extend_hours: false,
  ...ALL_WIDGETS_ON,
  widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
  ...W(['sales_history', 'payments', 'customers', 'stock', 'movements', 'categories', 'suppliers', 'transfers', 'expenses']),
}

export const DEFAULT_PERMISSIONS: AllPerms = {
  shop_manager: { ...MANAGER_BASE },
  manager: { ...MANAGER_BASE },
  // Remise : ouverte par défaut (décision du 5 oct. 2026 — c'était déjà le cas
  // avant ce réglage ; le propriétaire la retire au caissier qui en abuse)
  cashier: {
    new_sale: true, discount: true, sales_history: true, payments: true, customers: true,
    stock: false, movements: false, expiry_list: false, categories: false, suppliers: false, transfers: false,
    reports: false, revenue_chart: false, notes: false, expenses: false,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: false, extend_hours: false,
    ...ALL_WIDGETS_ON,
    ...W(['customers', 'payments']),
  },
  viewer: {
    new_sale: false, discount: false, sales_history: true, payments: true, customers: true,
    stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
    reports: true, revenue_chart: false, notes: false, expenses: false,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: false, extend_hours: false,
    ...ALL_WIDGETS_ON,
    widget_outstanding_debt: false, widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
    ...W([]),
  },
  stock_manager: {
    new_sale: false, discount: false, sales_history: false, payments: false, customers: false,
    stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
    reports: false, revenue_chart: false, notes: false, expenses: false,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: true, extend_hours: false,
    ...ALL_WIDGETS_ON,
    widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
    ...W(['stock', 'movements', 'categories', 'suppliers', 'transfers']),
  },
}

/** Interrupteur général : une fonction à « non » est masquée pour tout le monde, propriétaire compris */
export const DEFAULT_GENERAL: Record<PermFeature, boolean> = Object.fromEntries(
  [...LEVEL_FEATURES, ...SWITCH_FEATURES, ...WIDGET_FEATURES].map(k => [k, true])
) as Record<PermFeature, boolean>

// ── Résolution ──────────────────────────────────────────────────────────────
export interface Resolved { view: boolean; write: boolean }

export function resolvePermission(stored: StoredPermissions | null | undefined, role: string | null | undefined, feature: PermFeature): Resolved {
  if (role === 'super_admin') return { view: true, write: true }
  const general = stored?.general && feature in stored.general ? stored.general[feature]! : DEFAULT_GENERAL[feature]
  if (!general) return { view: false, write: false }
  if (!role || role === 'owner') return { view: true, write: true }
  const defaults = DEFAULT_PERMISSIONS[role as ConfigurableRole]
  if (!defaults) return { view: false, write: false }
  const own = stored?.[role as ConfigurableRole]
  const view = own && feature in own ? !!own[feature] : defaults[feature]
  if (role === 'viewer' && isViewerLocked(feature)) return { view: false, write: false }
  if (!isLevelFeature(feature)) return { view, write: view }
  if (!view || role === 'viewer') return { view, write: false }
  const wk = writeKey(feature)
  const write = own && wk in own ? !!own[wk] : (isLegacyGrant(own, feature) || defaults[wk])
  return { view, write }
}

/**
 * Réglage antérieur au lot 1 : un « oui » explicite sur une page valait
 * aussi modification côté serveur. Conservé tel quel (le propriétaire peut
 * désormais l'abaisser en « lecture ») ; sans effet pour l'Observateur.
 */
function isLegacyGrant(own: Partial<RolePerms> | undefined, feature: LevelFeature): boolean {
  return !!own && feature in own && !!own[feature] && !(writeKey(feature) in own)
}

export const canView = (stored: StoredPermissions | null | undefined, role: string | null | undefined, feature: PermFeature) =>
  resolvePermission(stored, role, feature).view
export const canWrite = (stored: StoredPermissions | null | undefined, role: string | null | undefined, feature: PermFeature) =>
  resolvePermission(stored, role, feature).write

// ── Aide pour l'écran des réglages ──────────────────────────────────────────
/** Réglages complets d'un rôle : défauts + valeurs enregistrées */
export function mergeRolePerms(role: ConfigurableRole, stored: StoredPermissions | null | undefined): RolePerms {
  const own = stored?.[role]
  const merged = { ...DEFAULT_PERMISSIONS[role], ...(own ?? {}) } as RolePerms
  // Même lecture des anciens « oui » que resolvePermission (niveau affiché = niveau appliqué)
  if (role !== 'viewer') for (const f of LEVEL_FEATURES) if (isLegacyGrant(own, f)) merged[writeKey(f)] = true
  return merged
}

export function levelOf(perms: RolePerms, role: ConfigurableRole, feature: LevelFeature): Level {
  if (!perms[feature]) return 'hidden'
  if (role === 'viewer') return 'read'
  return perms[writeKey(feature)] ? 'write' : 'read'
}

export function withLevel(perms: RolePerms, feature: LevelFeature, level: Level): RolePerms {
  return { ...perms, [feature]: level !== 'hidden', [writeKey(feature)]: level === 'write' }
}
