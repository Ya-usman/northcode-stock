import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'stockshop-offline'
const DB_VERSION = 4

export interface CachedProduct {
  id: string
  shop_id: string
  name: string
  sku: string | null
  selling_price: number
  buying_price: number
  quantity: number
  category_id: string | null
  is_active: boolean
  tax_rate?: number
  cached_at: number
}

export interface CachedCustomer {
  id: string
  shop_id: string
  name: string
  phone: string | null
  total_debt: number
  cached_at: number
}

export interface CachedExpense {
  id: string
  shop_id: string
  amount: number
  description: string
  date: string
  category: string
  payment_method: string
  is_recurring: boolean
  cached_at: number
}

export interface CachedCategory {
  id: string
  shop_id: string
  name: string
  name_hausa: string | null
  cached_at: number
}

export interface PendingMovement {
  local_id: string
  shop_id: string
  product_id: string
  product_name: string
  current_quantity: number
  quantity_to_add: number
  supplier_name: string | null
  buying_price: number | null
  notes: string | null
  performed_by: string
  created_at: string
  synced: boolean
  sync_error?: string
}

export interface PendingSaleItem {
  product_id: string | null
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
}

export interface PendingSale {
  local_id: string
  shop_id: string
  cashier_id: string
  subtotal: number
  discount: number
  tax: number
  total: number
  payment_method: string
  payment_status: string
  amount_paid: number
  balance: number
  customer_id: string | null
  customer_name: string | null
  customer_phone: string | null
  notes: string | null
  created_at: string
  items: PendingSaleItem[]
  payment_amount: number
  payment_reference: string | null
  synced: boolean
  sync_error?: string
}

let _db: Promise<IDBPDatabase> | null = null

function getDB() {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const products = db.createObjectStore('products', { keyPath: 'id' })
          products.createIndex('shop_id', 'shop_id')
          const sales = db.createObjectStore('pending_sales', { keyPath: 'local_id' })
          sales.createIndex('shop_id', 'shop_id')
          sales.createIndex('synced', 'synced')
        }
        if (oldVersion < 2) {
          const customers = db.createObjectStore('customers', { keyPath: 'id' })
          customers.createIndex('shop_id', 'shop_id')
        }
        if (oldVersion < 3) {
          const movements = db.createObjectStore('pending_movements', { keyPath: 'local_id' })
          movements.createIndex('shop_id', 'shop_id')
          movements.createIndex('synced', 'synced')
        }
        if (oldVersion < 4) {
          const expenses = db.createObjectStore('expenses', { keyPath: 'id' })
          expenses.createIndex('shop_id', 'shop_id')
          const categories = db.createObjectStore('categories', { keyPath: 'id' })
          categories.createIndex('shop_id', 'shop_id')
        }
      },
    })
  }
  return _db
}

// ── Products ────────────────────────────────────────────────────────────────

export async function cacheProducts(shopId: string, products: Omit<CachedProduct, 'cached_at'>[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('products', 'readwrite')
  // Delete all existing entries for this shop first, then insert fresh data
  const existing = await tx.store.index('shop_id').getAllKeys(shopId)
  await Promise.all(existing.map(key => tx.store.delete(key)))
  await Promise.all([
    ...products.map(p => tx.store.put({ ...p, shop_id: shopId, cached_at: Date.now() })),
    tx.done,
  ])
}

export async function getCachedProducts(shopId: string): Promise<CachedProduct[]> {
  const db = await getDB()
  return db.getAllFromIndex('products', 'shop_id', shopId)
}

// ── Customers ────────────────────────────────────────────────────────────────

export async function cacheCustomers(shopId: string, customers: Omit<CachedCustomer, 'cached_at'>[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('customers', 'readwrite')
  const existing = await tx.store.index('shop_id').getAllKeys(shopId)
  await Promise.all(existing.map(key => tx.store.delete(key)))
  await Promise.all([
    ...customers.map(c => tx.store.put({ ...c, shop_id: shopId, cached_at: Date.now() })),
    tx.done,
  ])
}

export async function getCachedCustomers(shopId: string): Promise<CachedCustomer[]> {
  const db = await getDB()
  return db.getAllFromIndex('customers', 'shop_id', shopId)
}

// ── Pending sales ────────────────────────────────────────────────────────────

export async function savePendingSale(sale: PendingSale): Promise<void> {
  const db = await getDB()
  await db.put('pending_sales', sale)
}

export async function getPendingSales(shopId: string): Promise<PendingSale[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('pending_sales', 'shop_id', shopId)
  return all.filter(s => !s.synced)
}

export async function getPendingCount(shopId: string): Promise<number> {
  return (await getPendingSales(shopId)).length
}

// Total unsynced across ALL shops — used to guard logout
export async function getTotalPendingCount(): Promise<number> {
  const db = await getDB()
  const [sales, movements] = await Promise.all([
    db.getAllFromIndex('pending_sales', 'synced', false as any),
    db.getAllFromIndex('pending_movements', 'synced', false as any),
  ])
  return sales.length + movements.length
}

export async function markSaleSynced(localId: string): Promise<void> {
  const db = await getDB()
  const sale = await db.get('pending_sales', localId)
  if (sale) await db.put('pending_sales', { ...sale, synced: true, sync_error: undefined })
}

export async function markSaleError(localId: string, error: string): Promise<void> {
  const db = await getDB()
  const sale = await db.get('pending_sales', localId)
  if (sale) await db.put('pending_sales', { ...sale, sync_error: error })
}

// ── Pending stock movements ───────────────────────────────────────────────────

export async function savePendingMovement(movement: PendingMovement): Promise<void> {
  const db = await getDB()
  await db.put('pending_movements', movement)
}

export async function getPendingMovements(shopId: string): Promise<PendingMovement[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('pending_movements', 'shop_id', shopId)
  return all.filter(m => !m.synced)
}

export async function getPendingMovementCount(shopId: string): Promise<number> {
  return (await getPendingMovements(shopId)).length
}

export async function markMovementSynced(localId: string): Promise<void> {
  const db = await getDB()
  const m = await db.get('pending_movements', localId)
  if (m) await db.put('pending_movements', { ...m, synced: true, sync_error: undefined })
}

export async function markMovementError(localId: string, error: string): Promise<void> {
  const db = await getDB()
  const m = await db.get('pending_movements', localId)
  if (m) await db.put('pending_movements', { ...m, sync_error: error })
}

// ── Expenses ─────────────────────────────────────────────────────────────────

export async function cacheExpenses(shopId: string, expenses: Omit<CachedExpense, 'cached_at'>[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('expenses', 'readwrite')
  const existing = await tx.store.index('shop_id').getAllKeys(shopId)
  await Promise.all(existing.map(key => tx.store.delete(key)))
  await Promise.all([
    ...expenses.map(e => tx.store.put({ ...e, shop_id: shopId, cached_at: Date.now() })),
    tx.done,
  ])
}

export async function getCachedExpenses(shopId: string): Promise<CachedExpense[]> {
  const db = await getDB()
  return db.getAllFromIndex('expenses', 'shop_id', shopId)
}

// ── Categories ───────────────────────────────────────────────────────────────

export async function cacheCategories(shopId: string, categories: Omit<CachedCategory, 'cached_at'>[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('categories', 'readwrite')
  const existing = await tx.store.index('shop_id').getAllKeys(shopId)
  await Promise.all(existing.map(key => tx.store.delete(key)))
  await Promise.all([
    ...categories.map(c => tx.store.put({ ...c, shop_id: shopId, cached_at: Date.now() })),
    tx.done,
  ])
}

export async function getCachedCategories(shopId: string): Promise<CachedCategory[]> {
  const db = await getDB()
  return db.getAllFromIndex('categories', 'shop_id', shopId)
}

// Update product quantity in IndexedDB cache (optimistic update for offline restock)
export async function updateCachedProductQuantity(productId: string, delta: number): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('products', 'readwrite')
  const product = await tx.store.get(productId)
  if (product) {
    await tx.store.put({ ...product, quantity: product.quantity + delta })
  }
  await tx.done
}
