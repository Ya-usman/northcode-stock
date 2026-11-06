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
//   - rôles en lecture seule (Observateur, Comptable) : JAMAIS de modification, quel que soit le réglage
//   - rôle inconnu : rien

export type ConfigurableRole = 'manager' | 'shop_manager' | 'cashier' | 'viewer' | 'stock_manager' | 'accountant'

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
  'view_purchase_cost',
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

export const CONFIGURABLE_ROLES: ConfigurableRole[] = ['shop_manager', 'manager', 'accountant', 'cashier', 'stock_manager', 'viewer']

/**
 * Rôles en LECTURE SEULE (lot Rôles, partie B, 6 nov. 2026) : Observateur et Comptable. Aucune modification, aucune
 * action d'écriture (READ_ONLY_LOCKED), quel que soit le réglage de la boutique. Seule règle à utiliser : jamais de
 * test sur le nom d'un de ces rôles ailleurs. Miroir SQL : role_can_view_feature (migration 214).
 */
export const READ_ONLY_ROLES = ['viewer', 'accountant'] as const
export function isReadOnlyRole(role: string | null | undefined): boolean {
  return !!role && (READ_ONLY_ROLES as readonly string[]).includes(role)
}

/** Rôles de direction : actions financières sensibles (annuler un paiement, passer une dette en perte, modifier une vente, fusionner des clients) */
export const MANAGERIAL_ROLES = ['owner', 'super_admin', 'shop_manager', 'manager'] as const
export function isManagerial(role: string | null | undefined): boolean {
  return !!role && (MANAGERIAL_ROLES as readonly string[]).includes(role)
}

export function isLevelFeature(f: string): f is LevelFeature {
  return (LEVEL_FEATURES as readonly string[]).includes(f)
}

/** Actions d'écriture à interrupteur : jamais ouvertes à un rôle en lecture seule, quel que soit le réglage */
export const READ_ONLY_LOCKED: readonly SwitchFeature[] = ['new_sale', 'discount', 'delete_products', 'delete_expenses', 'inventory_count', 'extend_hours', 'caisse']
export function isReadOnlyLocked(f: string): boolean {
  return (READ_ONLY_LOCKED as readonly string[]).includes(f)
}
/** Cette fonction est-elle verrouillée pour ce rôle (rôle en lecture seule + action d'écriture) ? */
export function isLockedFor(role: string | null | undefined, f: string): boolean {
  return isReadOnlyRole(role) && isReadOnlyLocked(f)
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

// view_purchase_cost (« Voir les prix d'achat et les coûts », décision D1 du 25 oct. 2026) : OUI par défaut pour
// Responsable et Manager (et Comptable, 6 nov.), NON pour Magasinier, Caissier et Observateur ; le propriétaire l'a toujours (canViewCost).
const MANAGER_BASE: RolePerms = {
  new_sale: true, discount: true, sales_history: true, payments: true, customers: true,
  stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
  reports: true, revenue_chart: false, notes: true, expenses: true,
  delete_products: false, delete_expenses: true, caisse: true, inventory_count: true, extend_hours: false,
  view_purchase_cost: true,
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
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: false, extend_hours: false, view_purchase_cost: false,
    ...ALL_WIDGETS_ON,
    ...W(['customers', 'payments']),
  },
  viewer: {
    new_sale: false, discount: false, sales_history: true, payments: true, customers: true,
    stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
    reports: true, revenue_chart: false, notes: false, expenses: false,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: false, extend_hours: false, view_purchase_cost: false,
    ...ALL_WIDGETS_ON,
    widget_outstanding_debt: false, widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
    ...W([]),
  },
  stock_manager: {
    new_sale: false, discount: false, sales_history: false, payments: false, customers: false,
    stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
    reports: false, revenue_chart: false, notes: false, expenses: false,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: true, extend_hours: false, view_purchase_cost: false,
    ...ALL_WIDGETS_ON,
    widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
    ...W(['stock', 'movements', 'categories', 'suppliers', 'transfers']),
  },
  // Comptable (6 nov. 2026) : consulte les chiffres pour tenir les comptes, sans rien modifier. Ventes, encaissements
  // et crédits, clients, dépenses, rapports, fournisseurs, stock et sa valeur, prix d'achat et marges. Ni vente, ni
  // caisse, ni inventaire, ni équipe, ni réglages. Lecture seule forcée par resolvePermission (READ_ONLY_ROLES).
  // revenue_chart (« Chiffre d'affaires de la boutique », migration 215) : OUI, encaissements du mois de toute la
  // boutique et graphique revenus / dépenses / résultat du tableau de bord.
  accountant: {
    new_sale: false, discount: false, sales_history: true, payments: true, customers: true,
    stock: true, movements: true, expiry_list: true, categories: true, suppliers: true, transfers: true,
    reports: true, revenue_chart: true, notes: false, expenses: true,
    delete_products: false, delete_expenses: false, caisse: false, inventory_count: false, extend_hours: false, view_purchase_cost: true,
    ...ALL_WIDGETS_ON,
    widget_dashboard_revenue_chart: false, widget_top_products_chart: false,
    ...W([]),
  },
}

/** Interrupteur général : une fonction à « non » est masquée pour tout le monde, propriétaire compris */
export const DEFAULT_GENERAL: Record<PermFeature, boolean> = Object.fromEntries(
  [...LEVEL_FEATURES, ...SWITCH_FEATURES, ...WIDGET_FEATURES].map(k => [k, true])
) as Record<PermFeature, boolean>

// ── Résolution ──────────────────────────────────────────────────────────────
export interface Resolved { view: boolean; write: boolean }

/**
 * Droits jamais masqués par l'onglet « Général » : le prix d'achat se règle rôle par rôle, et le propriétaire
 * le garde toujours (canViewCost) — un « non » général l'aurait retiré à tout le monde.
 */
export const GENERAL_EXEMPT: readonly PermFeature[] = ['view_purchase_cost']

export function resolvePermission(stored: StoredPermissions | null | undefined, role: string | null | undefined, feature: PermFeature): Resolved {
  if (role === 'super_admin') return { view: true, write: true }
  const general = GENERAL_EXEMPT.includes(feature) ? true
    : stored?.general && feature in stored.general ? stored.general[feature]! : DEFAULT_GENERAL[feature]
  if (!general) return { view: false, write: false }
  if (!role || role === 'owner') return { view: true, write: true }
  const defaults = DEFAULT_PERMISSIONS[role as ConfigurableRole]
  if (!defaults) return { view: false, write: false }
  const own = stored?.[role as ConfigurableRole]
  const view = own && feature in own ? !!own[feature] : defaults[feature]
  if (isLockedFor(role, feature)) return { view: false, write: false }
  if (!isLevelFeature(feature)) return { view, write: view }
  if (!view || isReadOnlyRole(role)) return { view, write: false }
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

/**
 * Qui voit les prix d'achat et tout ce qui en découle (valeur du stock, marge,
 * bénéfice, prix des bons de commande, prix comparés des fournisseurs) : LA
 * règle, à un seul endroit.
 *
 * Décision du 25 oct. 2026 (remplace la déduction « Stock ou Fournisseurs en modification » du 13 oct.) :
 *   propriétaire (et super_admin) : TOUJOURS, quel que soit le réglage — il ne peut pas se le retirer ;
 *   autres rôles : UNIQUEMENT la permission explicite `view_purchase_cost` (réglage du rôle dans la boutique,
 *   sinon valeur par défaut : Responsable, Manager et Comptable oui ; Magasinier, Caissier, Observateur non).
 * Gérer le stock, l'inventaire, les lots, les transferts ou les fournisseurs ne donne plus le coût.
 * Sans rôle connu : non — jamais de coût affiché « par défaut ».
 * Permission MÉTIER, jamais un droit SQL : le navigateur ne lit buying_price nulle part (migration C2) ; le coût
 * passe par les routes serveur, qui appliquent cette règle. Le serveur (lib/api/role-permissions) et les écrans
 * (useRolePermissions) la relaient : ne la réécrire nulle part ailleurs.
 *
 * ATTENTION — ce droit n'OUVRE aucun écran. C'est une condition de plus, à
 * l'intérieur d'un écran auquel la personne a déjà accès :
 *   marge / bénéfice dans Rapports = accès aux Rapports ET canViewCost ;
 *   coût dans le Stock            = accès au Stock      ET canViewCost ; etc.
 * Stock + coût sans accès aux Rapports → pas de Rapports. Rapports sans coût
 * → chiffre d'affaires, ventes, panier moyen, mais ni marge ni bénéfice.
 * Ne jamais s'en servir comme garde d'entrée d'une page ou d'une route.
 */
export function canViewCost(stored: StoredPermissions | null | undefined, role: string | null | undefined): boolean {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  return resolvePermission(stored, role, 'view_purchase_cost').view
}

// ── Aide pour l'écran des réglages ──────────────────────────────────────────
/** Réglages complets d'un rôle : défauts + valeurs enregistrées */
export function mergeRolePerms(role: ConfigurableRole, stored: StoredPermissions | null | undefined): RolePerms {
  const own = stored?.[role]
  const merged = { ...DEFAULT_PERMISSIONS[role], ...(own ?? {}) } as RolePerms
  // Même lecture des anciens « oui » que resolvePermission (niveau affiché = niveau appliqué)
  if (!isReadOnlyRole(role)) for (const f of LEVEL_FEATURES) if (isLegacyGrant(own, f)) merged[writeKey(f)] = true
  return merged
}

/** Toutes les clés réglables d'un rôle (pages, niveaux « modification », interrupteurs, cartes) */
export const ALL_PERM_KEYS: PermKey[] = [...LEVEL_FEATURES, ...LEVEL_FEATURES.map(writeKey), ...SWITCH_FEATURES, ...WIDGET_FEATURES]

export interface PermissionChange { role: ConfigurableRole | 'general'; permission: PermKey; from: boolean; to: boolean }

/**
 * Droits réellement changés entre deux réglages d'une boutique (journal d'audit) : valeur APPLIQUÉE avant / après
 * (défauts et anciens « oui » compris, comme mergeRolePerms) — renvoyer le même réglage ne produit aucun changement.
 */
export function permissionChanges(before: StoredPermissions | null | undefined, after: StoredPermissions | null | undefined): PermissionChange[] {
  const out: PermissionChange[] = []
  for (const role of CONFIGURABLE_ROLES) {
    const a = mergeRolePerms(role, before), b = mergeRolePerms(role, after)
    for (const k of ALL_PERM_KEYS) if (!!a[k] !== !!b[k]) out.push({ role, permission: k, from: !!a[k], to: !!b[k] })
  }
  const ga = { ...DEFAULT_GENERAL, ...(before?.general ?? {}) }, gb = { ...DEFAULT_GENERAL, ...(after?.general ?? {}) }
  for (const k of Object.keys(DEFAULT_GENERAL) as PermFeature[]) {
    if (GENERAL_EXEMPT.includes(k)) continue
    if (!!ga[k] !== !!gb[k]) out.push({ role: 'general', permission: k, from: !!ga[k], to: !!gb[k] })
  }
  return out
}

export function levelOf(perms: RolePerms, role: ConfigurableRole, feature: LevelFeature): Level {
  if (!perms[feature]) return 'hidden'
  if (isReadOnlyRole(role)) return 'read'
  return perms[writeKey(feature)] ? 'write' : 'read'
}

export function withLevel(perms: RolePerms, feature: LevelFeature, level: Level): RolePerms {
  return { ...perms, [feature]: level !== 'hidden', [writeKey(feature)]: level === 'write' }
}
