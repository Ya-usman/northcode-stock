import { createClient } from '@/lib/supabase/client'
import {
  getPendingSales, markSaleSynced, markSaleError,
  getPendingMovements, markMovementSynced, markMovementError,
  getPendingExpenses, markExpenseSynced, markExpenseError,
  getPendingCustomerPayments, markCustomerPaymentSynced, markCustomerPaymentError,
  getPendingSupplierPayments, markSupplierPaymentSynced, markSupplierPaymentError,
} from './db'
import { clearPageCacheByPrefix } from './page-cache'

// Register a Background Sync tag so the SW retries when connectivity is restored
export async function registerBackgroundSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg && 'sync' in reg) {
      await (reg as any).sync.register('sync-pending-sales')
    }
  } catch {
    // Background Sync not supported — online/offline events handle it
  }
}

export interface MovementSyncResult {
  synced: number
  failed: number
  errors: string[]
}

export async function syncPendingMovements(shopId: string): Promise<MovementSyncResult> {
  // Rafraîchir le token avant les appels API — même raison que syncPendingSales
  const supabaseCheck = createClient() as any
  const { data: { session } } = await supabaseCheck.auth.refreshSession()
  if (!session) return { synced: 0, failed: 0, errors: ['Session expirée.'] }

  const pending = await getPendingMovements(shopId)
  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const movement of pending) {
    try {
      const res = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: movement.product_id,
          shop_id: movement.shop_id,
          current_quantity: movement.current_quantity,
          quantity_to_add: movement.quantity_to_add,
          supplier_name: movement.supplier_name,
          supplier_id: movement.supplier_id,
          buying_price: movement.buying_price,
          expiry_date: movement.expiry_date,
          notes: movement.notes,
          performed_by: movement.performed_by,
        }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || `HTTP ${res.status}`)
      }
      await markMovementSynced(movement.local_id)
      synced++
    } catch (err: any) {
      const msg: string = err.message || String(err)
      await markMovementError(movement.local_id, msg)
      errors.push(msg)
      failed++
    }
  }

  if (synced > 0) clearPageCacheByPrefix('stock_')

  return { synced, failed, errors }
}

export interface SyncResult {
  synced: number
  failed: number
  errors: string[]
}

export async function syncPendingExpenses(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any
  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !session) {
    return { synced: 0, failed: 0, errors: ['Session expirée — reconnectez-vous pour synchroniser.'] }
  }

  const pending = await getPendingExpenses(shopId)
  let synced = 0, failed = 0
  const errors: string[] = []

  for (const expense of pending) {
    try {
      const { error: insertError } = await supabase.from('expenses').insert({
        shop_id:        expense.shop_id,
        amount:         expense.amount,
        description:    expense.description,
        date:           expense.date,
        category:       expense.category,
        payment_method: expense.payment_method,
        is_recurring:   false,
        created_at:     expense.created_at,
      })
      if (insertError) throw new Error(insertError.message)
      await markExpenseSynced(expense.local_id)
      synced++
    } catch (err: any) {
      const msg: string = err.message || String(err)
      await markExpenseError(expense.local_id, msg)
      errors.push(msg)
      failed++
    }
  }

  if (synced > 0) clearPageCacheByPrefix('expenses_')

  return { synced, failed, errors }
}

export async function syncPendingCustomerPayments(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any
  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !session) {
    return { synced: 0, failed: 0, errors: ['Session expirée — reconnectez-vous pour synchroniser.'] }
  }

  const pending = await getPendingCustomerPayments(shopId)
  let synced = 0, failed = 0
  const errors: string[] = []

  for (const payment of pending) {
    try {
      // client_request_id (= local_id) makes /api/payments idempotent — safe
      // to retry this loop across sync attempts without ever double-applying.
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unpaid_sale_ids: payment.unpaid_sale_ids,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          notes: payment.notes,
          shop_id: payment.shop_id,
          client_request_id: payment.local_id,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      await markCustomerPaymentSynced(payment.local_id)
      synced++
    } catch (err: any) {
      const msg: string = err.message || String(err)
      await markCustomerPaymentError(payment.local_id, msg)
      errors.push(msg)
      failed++
    }
  }

  if (synced > 0) clearPageCacheByPrefix('debtors_')

  return { synced, failed, errors }
}

export async function syncPendingSupplierPayments(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any
  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !session) {
    return { synced: 0, failed: 0, errors: ['Session expirée — reconnectez-vous pour synchroniser.'] }
  }

  const pending = await getPendingSupplierPayments(shopId)
  let synced = 0, failed = 0
  const errors: string[] = []

  for (const payment of pending) {
    try {
      const res = await fetch('/api/supplier-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchase_order_ids: payment.purchase_order_ids,
          amount: payment.amount,
          method: payment.method,
          reference: payment.reference,
          notes: payment.notes,
          shop_id: payment.shop_id,
          client_request_id: payment.local_id,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      await markSupplierPaymentSynced(payment.local_id)
      synced++
    } catch (err: any) {
      const msg: string = err.message || String(err)
      await markSupplierPaymentError(payment.local_id, msg)
      errors.push(msg)
      failed++
    }
  }

  if (synced > 0) clearPageCacheByPrefix('supplier_debtors_')

  return { synced, failed, errors }
}

export async function syncPendingSales(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any

  // Rafraîchir le token avant de syncer — le JWT expire après ~1h hors ligne.
  // refreshSession() utilise le refresh token (valide 7+ jours) pour obtenir
  // un nouvel access token. getSession() ne fait que lire le localStorage
  // et ne détecte pas l'expiration.
  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()
  if (refreshError || !session) {
    return { synced: 0, failed: 1, errors: ['Session expirée — reconnectez-vous pour synchroniser.'] }
  }

  const pending = await getPendingSales(shopId)

  let synced = 0
  let failed = 0
  const errors: string[] = []

  for (const sale of pending) {
    try {
      // Resolve customer_id: use saved ID, or look up by phone, or create new
      let customerId = sale.customer_id ?? null
      if (!customerId && sale.customer_name) {
        if (sale.customer_phone) {
          const { data: existing } = await supabase
            .from('customers')
            .select('id')
            .eq('shop_id', sale.shop_id)
            .eq('phone', sale.customer_phone)
            .maybeSingle()
          customerId = existing?.id ?? null
        }
        if (!customerId) {
          const { data: newCust } = await supabase
            .from('customers')
            .insert({ shop_id: sale.shop_id, name: sale.customer_name, phone: sale.customer_phone || null })
            .select('id')
            .single()
          customerId = newCust?.id ?? null
        }
      }

      // 'mixed' is not a valid payment_method in the DB; map to 'cash'.
      // The offline PendingSale schema stores only a single payment_amount with no
      // per-method breakdown, so the original cash/transfer split cannot be reconstructed
      // here. A note is added to the payment record to flag this data loss.
      const isMixedPayment = sale.payment_method === 'mixed'
      const dbPaymentMethod = isMixedPayment ? 'cash' : sale.payment_method

      // local_id is stable across sync retries (it's the IndexedDB keyPath,
      // generated once when the sale was first saved offline) — reuse it as
      // the server-side idempotency key. This protects against the sync
      // running from two different JS contexts at once (e.g. the service
      // worker's Background Sync firing while the app is also open and
      // syncing itself), which an in-memory lock alone can't prevent since
      // they don't share memory.
      let saleAlreadyExisted = false
      const { data: alreadyCreated } = await supabase
        .from('sales')
        .select('id')
        .eq('client_request_id', sale.local_id)
        .maybeSingle()

      let saleData: { id: string } | null = alreadyCreated
      if (alreadyCreated) {
        saleAlreadyExisted = true
      } else {
        const { data: inserted, error: saleError } = await supabase
          .from('sales')
          .insert({
            shop_id: sale.shop_id,
            cashier_id: sale.cashier_id,
            customer_id: customerId,
            subtotal: sale.subtotal,
            discount: sale.discount,
            tax: sale.tax,
            total: sale.total,
            payment_method: dbPaymentMethod,
            payment_status: 'pending',
            // Always start at 0; the after_payment_insert trigger increments amount_paid when the
            // payment record is inserted below (same flow as the online path).
            // Setting amount_paid directly AND inserting a payment record would fire the trigger
            // and double-count: amount_paid = initial_value + payment_amount > total → balance < 0.
            amount_paid: 0,
            notes: sale.notes,
            sale_status: 'active',
            created_at: sale.created_at,
            client_request_id: sale.local_id,
          })
          .select('id')
          .single()

        if (saleError?.code === '23505' && saleError.message?.includes('client_request_id')) {
          const { data: raced } = await supabase.from('sales').select('id').eq('client_request_id', sale.local_id).maybeSingle()
          saleData = raced ?? null
          saleAlreadyExisted = Boolean(raced)
        } else if (saleError || !inserted) {
          throw new Error(saleError?.message || 'Failed to insert sale')
        } else {
          saleData = inserted
        }
      }

      if (!saleData) throw new Error('Failed to insert sale')

      // If the sale already existed (idempotent retry), its items/payment were
      // presumably already inserted by the earlier successful attempt.
      let itemsAlreadyExist = false
      let paymentAlreadyExists = false
      if (saleAlreadyExisted) {
        const [{ count: itemsCount }, { count: paymentsCount }] = await Promise.all([
          supabase.from('sale_items').select('id', { count: 'exact', head: true }).eq('sale_id', saleData.id),
          supabase.from('payments').select('id', { count: 'exact', head: true }).eq('sale_id', saleData.id),
        ])
        itemsAlreadyExist = Boolean(itemsCount)
        paymentAlreadyExists = Boolean(paymentsCount)
      }

      if (sale.items.length > 0 && !itemsAlreadyExist) {
        const { error: itemsError } = await supabase
          .from('sale_items')
          .insert(sale.items.map(item => ({
            sale_id: saleData.id,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            // subtotal is GENERATED (quantity * unit_price) — do not insert it
          })))
        if (itemsError) throw new Error(itemsError.message)
      }

      if (dbPaymentMethod !== 'credit' && sale.payment_amount > 0 && !paymentAlreadyExists) {
        const { error: paymentError } = await supabase.from('payments').insert({
          sale_id: saleData.id,
          amount: sale.payment_amount,
          method: dbPaymentMethod,
          reference: sale.payment_reference,
          received_by: sale.cashier_id,
          // Preserve original sale timestamp so the is_repayment heuristic
          // (paid_at > created_at + 5 min) doesn't fire for delayed syncs.
          paid_at: sale.created_at,
          // Mixed payments lose their cash/transfer split in offline mode — document it.
          notes: isMixedPayment ? 'Paiement mixte (sync offline — méthode enregistrée comme espèces, détail du split non disponible)' : null,
        })
        if (paymentError) {
          // Don't throw here: the sale + items already exist online, so retrying
          // this sale on the next sync pass would re-insert it as a duplicate.
          // payment_status was already set to 'pending' at sale creation above,
          // so this safely surfaces as a debt to reconcile instead of hiding it.
          // Count it under `failed` (even though the sale itself did sync) so the
          // offline banner actually shows this to the user instead of a silent
          // success checkmark hiding an unconfirmed payment.
          console.error('[sync] Sale synced but payment record failed', sale.local_id, paymentError)
          errors.push(`Vente #${sale.local_id} synchronisée mais paiement non confirmé : ${paymentError.message}`)
          failed++
        }
      }

      await markSaleSynced(sale.local_id)
      synced++
    } catch (err: any) {
      const msg: string = err.message || String(err)
      console.error('[sync] Failed to sync sale', sale.local_id, err)
      await markSaleError(sale.local_id, msg)
      errors.push(msg)
      failed++
    }
  }

  if (synced > 0) {
    clearPageCacheByPrefix('sales_history_v2_')
    clearPageCacheByPrefix('stock_')
    clearPageCacheByPrefix('debtors_')
  }

  return { synced, failed, errors }
}

export interface CombinedSyncResult {
  synced: number
  failed: number
  errors: string[]
}

// Module-level (process-wide) lock. syncPendingSales/Movements/Expenses read
// still-unsynced items from IndexedDB and only mark them synced at the very
// end of each iteration — if two callers run this concurrently (this app has
// several independent triggers: the OfflineBanner button, the auto-sync-on-
// reconnect hook mounted in multiple components at once, and the sign-out
// flow), both can read the SAME pending item before either marks it synced,
// inserting it twice server-side. Every caller must go through this single
// function so concurrent triggers join the same in-flight sync instead of
// each starting their own pass over the same pending queue.
let globalSyncPromise: Promise<CombinedSyncResult> | null = null

export async function syncAllPending(shopId: string): Promise<CombinedSyncResult> {
  if (globalSyncPromise) return globalSyncPromise
  globalSyncPromise = (async () => {
    try {
      const [salesResult, movResult, expResult, custPayResult, supPayResult] = await Promise.all([
        syncPendingSales(shopId),
        syncPendingMovements(shopId),
        syncPendingExpenses(shopId),
        syncPendingCustomerPayments(shopId),
        syncPendingSupplierPayments(shopId),
      ])
      return {
        synced: salesResult.synced + movResult.synced + expResult.synced + custPayResult.synced + supPayResult.synced,
        failed: salesResult.failed + movResult.failed + expResult.failed + custPayResult.failed + supPayResult.failed,
        errors: [...salesResult.errors, ...movResult.errors, ...expResult.errors, ...custPayResult.errors, ...supPayResult.errors],
      }
    } finally {
      globalSyncPromise = null
    }
  })()
  return globalSyncPromise
}
