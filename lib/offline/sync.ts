import { createClient } from '@/lib/supabase/client'
import {
  getPendingSales, markSaleSynced, markSaleError, getPendingCount,
  getPendingMovements, markMovementSynced, markMovementError,
  getPendingExpenses, markExpenseSynced, markExpenseError,
  getPendingCustomerPayments, markCustomerPaymentSynced, markCustomerPaymentError,
  getPendingSupplierPayments, markSupplierPaymentSynced, markSupplierPaymentError,
} from './db'
import { clearPageCacheByPrefix } from './page-cache'
import { queryClient } from '@/lib/query-client'
import { invalidateSalesData } from '@/lib/query-keys'

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
      // Par le serveur (lot 2) : mêmes contrôles qu'en ligne ; local_id = clé
      // d'idempotence (migration 156) → jamais deux fois la même dépense, et
      // l'heure réelle de la saisie est conservée.
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id:           expense.shop_id,
          amount:            expense.amount,
          description:       expense.description,
          date:              expense.date,
          category:          expense.category,
          payment_method:    expense.payment_method,
          is_recurring:      false,
          client_request_id: expense.local_id,
          created_at:        expense.created_at,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
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
      // Lot 3 (migration 159) : la vente passe par le serveur — mêmes contrôles
      // que la caisse en ligne, tout ou rien (complete_sale), jamais en double
      // (clé = local_id), heure réelle conservée. Une vente non conforme n'est
      // pas refusée : elle est enregistrée et marquée « à vérifier » (l'argent
      // est encaissé). Seules les vraies erreurs restent en file avec leur message.
      const res = await fetch('/api/sales/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale),
        signal: AbortSignal.timeout(30_000),
      })
      if (res.status === 401) throw new Error('Session expirée — reconnectez-vous pour synchroniser.')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || `Erreur serveur (${res.status})`)
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
    invalidateSalesData(queryClient)
  }

  return { synced, failed, errors }
}

/**
 * Synchronisation rapide après une mise en file (vente, paiement…) quand le
 * téléphone a du réseau : tout de suite, puis à 5 s et 15 s tant que la file
 * n'est pas vide. Avant, il fallait attendre la boucle de 30 s — et si Android
 * fermait l'app entre-temps (ouverture de WhatsApp), la vente restait en file
 * jusqu'à une synchronisation manuelle.
 */
export function syncSoon(shopId: string): void {
  const delays = [0, 5_000, 15_000]
  for (const d of delays) {
    setTimeout(async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      try {
        if ((await getPendingCount(shopId)) > 0) await syncAllPending(shopId)
      } catch { /* nouvel essai au palier suivant ou par la boucle de fond */ }
    }, d)
  }
}

/**
 * Synchronise MAINTENANT (au plus `timeoutMs`) et renvoie la vente telle
 * qu'enregistrée sur le serveur (vrai numéro, lignes, client), ou null si
 * elle n'a pas pu être envoyée. Utilisé avant d'envoyer ou d'imprimer le reçu
 * d'une vente mise en file : jamais de lien de reçu inactif.
 */
export async function syncSaleNow(shopId: string, localId: string, timeoutMs = 10_000): Promise<any | null> {
  const supabase = createClient() as any
  const find = async () => {
    const onlineKey = localId.startsWith('local-') ? localId.slice(6) : null
    const { data } = await supabase
      .from('sales')
      .select('*, sale_items(*), customers(id, name, phone)')
      .in('client_request_id', onlineKey ? [localId, onlineKey] : [localId])
      .limit(1)
      .maybeSingle()
    return data ?? null
  }
  try {
    await Promise.race([
      syncAllPending(shopId),
      new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ])
    return await find()
  } catch {
    return null
  }
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
