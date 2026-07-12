import { useAuthContext } from '@/lib/contexts/auth-context'

export type PermFeature =
  | 'new_sale' | 'sales_history' | 'payments' | 'customers'
  | 'stock' | 'movements' | 'categories' | 'suppliers' | 'reports'
  | 'revenue_chart' | 'notes' | 'expenses' | 'delete_products' | 'caisse'
  | 'inventory_count'
  // Dashboard widgets — finer-grained than the page-level flags above
  | 'widget_today_revenue' | 'widget_sales_count' | 'widget_stock_alerts_card'
  | 'widget_outstanding_debt' | 'widget_net_result' | 'widget_stock_alerts_list'
  | 'widget_dashboard_revenue_chart' | 'widget_top_products_chart' | 'widget_recent_sales'
  // Reports widgets
  | 'widget_rep_encaisse' | 'widget_rep_depenses' | 'widget_rep_transactions'
  | 'widget_rep_marge_brute' | 'widget_rep_benefice_net' | 'widget_rep_credits'
  | 'widget_rep_payment_chart' | 'widget_rep_top_products' | 'widget_rep_cashier_perf'

export type ConfigurableRole = 'manager' | 'shop_manager' | 'cashier' | 'viewer' | 'stock_manager'

export type RolePerms = Record<PermFeature, boolean>
export type AllPerms = Record<ConfigurableRole, RolePerms>

export const DEFAULT_PERMISSIONS: AllPerms = {
  shop_manager: {
    new_sale: true,
    sales_history: true,
    payments: true,
    customers: true,
    stock: true,
    movements: true,
    categories: true,
    suppliers: true,
    reports: true,
    revenue_chart: false,
    notes: true,
    expenses: true,
    delete_products: false,
    caisse: true,
    inventory_count: true,
    widget_today_revenue: true,
    widget_sales_count: true,
    widget_stock_alerts_card: true,
    widget_outstanding_debt: true,
    widget_net_result: true,
    widget_stock_alerts_list: true,
    widget_dashboard_revenue_chart: false,
    widget_top_products_chart: false,
    widget_recent_sales: true,
    widget_rep_encaisse: true,
    widget_rep_depenses: true,
    widget_rep_transactions: true,
    widget_rep_marge_brute: true,
    widget_rep_benefice_net: true,
    widget_rep_credits: true,
    widget_rep_payment_chart: true,
    widget_rep_top_products: true,
    widget_rep_cashier_perf: true,
  },
  manager: {
    new_sale: true,
    sales_history: true,
    payments: true,
    customers: true,
    stock: true,
    movements: true,
    categories: true,
    suppliers: true,
    reports: true,
    revenue_chart: false,
    notes: true,
    expenses: true,
    delete_products: false,
    caisse: true,
    inventory_count: true,
    widget_today_revenue: true,
    widget_sales_count: true,
    widget_stock_alerts_card: true,
    widget_outstanding_debt: true,
    widget_net_result: true,
    widget_stock_alerts_list: true,
    widget_dashboard_revenue_chart: false,
    widget_top_products_chart: false,
    widget_recent_sales: true,
    widget_rep_encaisse: true,
    widget_rep_depenses: true,
    widget_rep_transactions: true,
    widget_rep_marge_brute: true,
    widget_rep_benefice_net: true,
    widget_rep_credits: true,
    widget_rep_payment_chart: true,
    widget_rep_top_products: true,
    widget_rep_cashier_perf: true,
  },
  cashier: {
    new_sale: true,
    sales_history: true,
    payments: true,
    customers: true,
    stock: false,
    movements: false,
    categories: false,
    suppliers: false,
    reports: false,
    revenue_chart: false,
    notes: false,
    expenses: false,
    delete_products: false,
    caisse: false,
    inventory_count: false,
    widget_today_revenue: true,
    widget_sales_count: true,
    widget_stock_alerts_card: true,
    widget_outstanding_debt: true,
    widget_net_result: true,
    widget_stock_alerts_list: true,
    widget_dashboard_revenue_chart: true,
    widget_top_products_chart: true,
    widget_recent_sales: true,
    widget_rep_encaisse: true,
    widget_rep_depenses: true,
    widget_rep_transactions: true,
    widget_rep_marge_brute: true,
    widget_rep_benefice_net: true,
    widget_rep_credits: true,
    widget_rep_payment_chart: true,
    widget_rep_top_products: true,
    widget_rep_cashier_perf: true,
  },
  viewer: {
    new_sale: false,
    sales_history: true,
    payments: true,
    customers: true,
    stock: true,
    movements: true,
    categories: true,
    suppliers: true,
    reports: true,
    revenue_chart: false,
    notes: false,
    expenses: false,
    delete_products: false,
    caisse: false,
    inventory_count: false,
    widget_today_revenue: true,
    widget_sales_count: true,
    widget_stock_alerts_card: true,
    widget_outstanding_debt: false,
    widget_net_result: true,
    widget_stock_alerts_list: true,
    widget_dashboard_revenue_chart: false,
    widget_top_products_chart: false,
    widget_recent_sales: true,
    widget_rep_encaisse: true,
    widget_rep_depenses: true,
    widget_rep_transactions: true,
    widget_rep_marge_brute: true,
    widget_rep_benefice_net: true,
    widget_rep_credits: true,
    widget_rep_payment_chart: true,
    widget_rep_top_products: true,
    widget_rep_cashier_perf: true,
  },
  stock_manager: {
    new_sale: false,
    sales_history: false,
    payments: false,
    customers: false,
    stock: true,
    movements: true,
    categories: true,
    suppliers: true,
    reports: false,
    revenue_chart: false,
    notes: false,
    expenses: false,
    delete_products: false,
    caisse: false,
    inventory_count: true,
    widget_today_revenue: true,
    widget_sales_count: true,
    widget_stock_alerts_card: true,
    widget_outstanding_debt: true,
    widget_net_result: true,
    widget_stock_alerts_list: true,
    widget_dashboard_revenue_chart: false,
    widget_top_products_chart: false,
    widget_recent_sales: true,
    widget_rep_encaisse: true,
    widget_rep_depenses: true,
    widget_rep_transactions: true,
    widget_rep_marge_brute: true,
    widget_rep_benefice_net: true,
    widget_rep_credits: true,
    widget_rep_payment_chart: true,
    widget_rep_top_products: true,
    widget_rep_cashier_perf: true,
  },
}

// Master switch above all roles — when a feature is off here, it's hidden for
// everyone in the shop, including the owner. Derived from an existing role's
// keys (all forced to true) instead of retyped by hand, so it can't drift out
// of sync when a new PermFeature is added.
export const DEFAULT_GENERAL: RolePerms = Object.fromEntries(
  Object.keys(DEFAULT_PERMISSIONS.manager).map(k => [k, true])
) as RolePerms

export function useRolePermissions() {
  const { shop, profile, roleInActiveShop } = useAuthContext()
  // roleInActiveShop (from shop_members) is authoritative; fall back to profiles.role
  const role = roleInActiveShop ?? profile?.role
  const stored = (shop as any)?.role_permissions as (Partial<AllPerms> & { general?: Partial<RolePerms> }) | null | undefined

  function canAccess(feature: PermFeature): boolean {
    // Platform admin bypasses everything, regardless of any shop's own config.
    if (role === 'super_admin') return true

    const generalStored = stored?.general
    const generalEnabled = generalStored && feature in generalStored ? generalStored[feature]! : DEFAULT_GENERAL[feature]
    if (!generalEnabled) return false // hidden for everyone, including the owner

    if (!role || role === 'owner') return true
    const cfgRole = role as ConfigurableRole
    if (!DEFAULT_PERMISSIONS[cfgRole]) return false
    const override = stored?.[cfgRole]
    if (override && feature in override) return override[feature]!
    return DEFAULT_PERMISSIONS[cfgRole][feature]
  }

  // Merged permissions (defaults + stored overrides) for all configurable roles
  const permissions: AllPerms = {
    shop_manager:  { ...DEFAULT_PERMISSIONS.shop_manager,  ...(stored?.shop_manager  ?? {}) },
    manager:       { ...DEFAULT_PERMISSIONS.manager,       ...(stored?.manager       ?? {}) },
    cashier:       { ...DEFAULT_PERMISSIONS.cashier,       ...(stored?.cashier       ?? {}) },
    viewer:        { ...DEFAULT_PERMISSIONS.viewer,        ...(stored?.viewer        ?? {}) },
    stock_manager: { ...DEFAULT_PERMISSIONS.stock_manager, ...(stored?.stock_manager ?? {}) },
  }

  return { canAccess, permissions }
}
