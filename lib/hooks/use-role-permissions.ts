import { useAuthContext } from '@/lib/contexts/auth-context'

export type PermFeature =
  | 'new_sale' | 'sales_history' | 'payments' | 'customers'
  | 'stock' | 'movements' | 'categories' | 'suppliers' | 'reports'
  | 'revenue_chart' | 'notes' | 'expenses'

export type ConfigurableRole = 'manager' | 'cashier' | 'viewer' | 'stock_manager'

export type RolePerms = Record<PermFeature, boolean>
export type AllPerms = Record<ConfigurableRole, RolePerms>

export const DEFAULT_PERMISSIONS: AllPerms = {
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
  },
}

export function useRolePermissions() {
  const { shop, profile, roleInActiveShop } = useAuthContext()
  // roleInActiveShop (from shop_members) is authoritative; fall back to profiles.role
  const role = roleInActiveShop ?? profile?.role
  const stored = (shop as any)?.role_permissions as Partial<AllPerms> | null | undefined

  function canAccess(feature: PermFeature): boolean {
    if (!role || role === 'owner' || role === 'super_admin') return true
    const cfgRole = role as ConfigurableRole
    if (!DEFAULT_PERMISSIONS[cfgRole]) return false
    const override = stored?.[cfgRole]
    if (override && feature in override) return override[feature]!
    return DEFAULT_PERMISSIONS[cfgRole][feature]
  }

  // Merged permissions (defaults + stored overrides) for all configurable roles
  const permissions: AllPerms = {
    manager:       { ...DEFAULT_PERMISSIONS.manager,       ...(stored?.manager       ?? {}) },
    cashier:       { ...DEFAULT_PERMISSIONS.cashier,       ...(stored?.cashier       ?? {}) },
    viewer:        { ...DEFAULT_PERMISSIONS.viewer,        ...(stored?.viewer        ?? {}) },
    stock_manager: { ...DEFAULT_PERMISSIONS.stock_manager, ...(stored?.stock_manager ?? {}) },
  }

  return { canAccess, permissions }
}
