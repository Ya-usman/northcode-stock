// Adresse d'un écran → fonction (permission) qui l'ouvre. Source UNIQUE de la garde d'entrée des écrans
// (components/layout/route-guard.tsx) : un écran masqué pour un rôle ne s'ouvre pas non plus en tapant son adresse
// (constat de l'étape D, 25 oct. 2026 : Dépenses, Historique, Clients, Produits… s'ouvraient par l'adresse).
// Même règle que le menu (useNavAccess). Règles les plus précises d'abord. Module pur (testé sans navigateur).
// Caisse (sales/new) absente EXPRÈS : elle se garde elle-même boutique par boutique (droit « vente » en écriture,
// message « pas le droit de vendre dans X ») sans monter l'écran de vente, donc sans aucune lecture.
import type { PermFeature } from '@/lib/permissions'

export interface RouteRule { prefix: string; feature: PermFeature }

export const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: 'sales/history', feature: 'sales_history' },
  { prefix: 'payments', feature: 'payments' },
  { prefix: 'customers', feature: 'customers' },
  { prefix: 'stock/movements', feature: 'movements' },
  { prefix: 'stock/expiry', feature: 'expiry_list' },
  { prefix: 'stock/transfers', feature: 'transfers' },
  { prefix: 'stock/inventory-count', feature: 'inventory_count' },
  { prefix: 'stock/products', feature: 'stock' },
  { prefix: 'stock', feature: 'stock' },
  { prefix: 'categories', feature: 'categories' },
  { prefix: 'suppliers', feature: 'suppliers' },
  { prefix: 'caisse', feature: 'caisse' },
  { prefix: 'reports', feature: 'reports' },
  { prefix: 'notes', feature: 'notes' },
  { prefix: 'expenses', feature: 'expenses' },
]

/** Règle de l'écran pour une adresse (« /fr/stock/expiry?x=1 » ou « stock/expiry ») ; null = écran sans fonction */
export function ruleForPath(pathname: string): RouteRule | null {
  const p = pathname.split(/[?#]/)[0].replace(/^\/+/, '').replace(/^(fr|en|ha)(\/|$)/, '').replace(/\/+$/, '')
  return ROUTE_RULES.find(r => p === r.prefix || p.startsWith(r.prefix + '/')) ?? null
}
