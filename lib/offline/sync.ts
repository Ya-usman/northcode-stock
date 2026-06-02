import { createClient } from '@/lib/supabase/client'
import { getPendingSales, markSaleSynced, markSaleError, getPendingMovements, markMovementSynced, markMovementError } from './db'

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
          buying_price: movement.buying_price,
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

  return { synced, failed, errors }
}

export interface SyncResult {
  synced: number
  failed: number
  errors: string[]
}

export async function syncPendingSales(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any

  // Ensure the session is fresh before syncing — it may have expired while offline
  const { error: sessionError } = await supabase.auth.getSession()
  if (sessionError) {
    return { synced: 0, failed: 0, errors: [] }
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

      // 'mixed' is not a valid payment_method in the DB; map to 'cash'
      const dbPaymentMethod = sale.payment_method === 'mixed' ? 'cash' : sale.payment_method

      const { data: saleData, error: saleError } = await supabase
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
          payment_status: sale.payment_status,
          amount_paid: 0,
          // balance is GENERATED (total - amount_paid); amount_paid is updated by the after_payment_insert trigger
          notes: sale.notes,
          sale_status: 'active',
          created_at: sale.created_at,
        })
        .select('id')
        .single()

      if (saleError || !saleData) throw new Error(saleError?.message || 'Failed to insert sale')

      if (sale.items.length > 0) {
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

      if (dbPaymentMethod !== 'credit' && sale.payment_amount > 0) {
        await supabase.from('payments').insert({
          sale_id: saleData.id,
          amount: sale.payment_amount,
          method: dbPaymentMethod,
          reference: sale.payment_reference,
          received_by: sale.cashier_id,
        })
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

  return { synced, failed, errors }
}
