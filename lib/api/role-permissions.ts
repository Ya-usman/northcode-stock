// Server-side counterpart to lib/hooks/use-role-permissions.ts. That hook is
// React/client-only (it reads useAuthContext), so API routes can't import it
// directly — this reads the same shops.role_permissions JSONB column and
// applies the same per-role defaults by hand, kept in sync manually whenever
// DEFAULT_PERMISSIONS changes there for one of the features listed below.

export type ConfigurableRole = 'manager' | 'shop_manager' | 'cashier' | 'viewer' | 'stock_manager'

// Only features actually enforced server-side so far — extend as more API
// routes adopt hasRolePermission() instead of a hardcoded role array.
export type ServerCheckedFeature =
  | 'stock' | 'movements' | 'categories' | 'suppliers' | 'payments'
  | 'inventory_count' | 'delete_products' | 'delete_expenses'

const FEATURE_DEFAULTS: Record<ServerCheckedFeature, Record<ConfigurableRole, boolean>> = {
  stock:           { manager: true,  shop_manager: true,  cashier: false, viewer: true,  stock_manager: true },
  movements:       { manager: true,  shop_manager: true,  cashier: false, viewer: true,  stock_manager: true },
  categories:      { manager: true,  shop_manager: true,  cashier: false, viewer: true,  stock_manager: true },
  suppliers:       { manager: true,  shop_manager: true,  cashier: false, viewer: true,  stock_manager: true },
  payments:        { manager: true,  shop_manager: true,  cashier: true,  viewer: true,  stock_manager: false },
  inventory_count: { manager: true,  shop_manager: true,  cashier: false, viewer: false, stock_manager: true },
  delete_products: { manager: false, shop_manager: false, cashier: false, viewer: false, stock_manager: false },
  delete_expenses: { manager: false, shop_manager: false, cashier: false, viewer: false, stock_manager: false },
}

function isConfigurableRole(role: string): role is ConfigurableRole {
  return role in FEATURE_DEFAULTS.stock
}

/**
 * Resolves whether `role` may use `feature` in `shop_id`, honoring the
 * owner's "Accès par rôle" overrides (shops.role_permissions) with a
 * fallback to that role's default when the owner never customized it.
 * owner/super_admin always pass; `alwaysAllow` grants extra roles an
 * unconditional pass regardless of the stored/default value (for roles a
 * route has always trusted with this action independently of the toggle).
 */
export async function hasRolePermission(
  supabase: any,
  role: string | null | undefined,
  shop_id: string,
  feature: ServerCheckedFeature,
  opts?: { alwaysAllow?: string[] }
): Promise<boolean> {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  if (opts?.alwaysAllow?.includes(role)) return true
  if (!isConfigurableRole(role)) return false

  const { data: shopData } = await supabase
    .from('shops').select('role_permissions').eq('id', shop_id).single()
  const override = shopData?.role_permissions?.[role]?.[feature]
  if (override !== undefined) return Boolean(override)
  return FEATURE_DEFAULTS[feature][role]
}
