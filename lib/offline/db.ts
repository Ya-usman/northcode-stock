import { openDB, type IDBPDatabase } from 'idb'

const DB_NAME = 'stockshop-offline'
const DB_VERSION = 1

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
  customer_name: string | null
  customer_phone: string | null
  notes: string | null
  created_at: string
  items: PendingSaleItem[]
  // Payment record to insert after sale
  payment_amount: number
  payment_reference: string | null
  synced: boolean
  sync_error?: string
}

let _db: Promise<IDBPDatabase> | null = null

function getDB() {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('products')) {
          const store = db.createObjectStore('products', { keyPath: 'id' })
          store.createIndex('shop_id', 'shop_id')
        }
        if (!db.objectStoreNames.contains('pending_sales')) {
          const store = db.createObjectStore('pending_sales', { keyPath: 'local_id' })
          store.createIndex('shop_id', 'shop_id')
          store.createIndex('synced', 'synced')
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
  await Promise.all([
    ...products.map(p => tx.store.put({ ...p, shop_id: shopId, cached_at: Date.now() })),
    tx.done,
  ])
}

export async function getCachedProducts(shopId: string): Promise<CachedProduct[]> {
  const db = await getDB()
  return db.getAllFromIndex('products', 'shop_id', shopId)
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
