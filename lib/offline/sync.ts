import { createClient } from '@/lib/supabase/client'
import { getPendingSales, markSaleSynced, markSaleError } from './db'

export interface SyncResult {
  synced: number
  failed: number
}

export async function syncPendingSales(shopId: string): Promise<SyncResult> {
  const supabase = createClient() as any
  const pending = await getPendingSales(shopId)

  let synced = 0
  let failed = 0

  for (const sale of pending) {
    try {
      // 1. Insert the sale
      const { data: saleData, error: saleError } = await supabase
        .from('sales')
        .insert({
          shop_id: sale.shop_id,
          cashier_id: sale.cashier_id,
          subtotal: sale.subtotal,
          discount: sale.discount,
          tax: sale.tax,
          total: sale.total,
          payment_method: sale.payment_method,
          payment_status: sale.payment_status,
          amount_paid: 0, // DB trigger handles this via payments insert
          balance: sale.balance,
          customer_name: sale.customer_name,
          customer_phone: sale.customer_phone,
          notes: sale.notes,
          sale_status: 'active',
          created_at: sale.created_at,
        })
        .select('id')
        .single()

      if (saleError || !saleData) throw new Error(saleError?.message || 'Failed to insert sale')

      // 2. Insert sale items
      if (sale.items.length > 0) {
        const { error: itemsError } = await supabase
          .from('sale_items')
          .insert(sale.items.map(item => ({
            sale_id: saleData.id,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.subtotal,
          })))
        if (itemsError) throw new Error(itemsError.message)
      }

      // 3. Insert payment record if applicable
      if (sale.payment_method !== 'credit' && sale.payment_amount > 0) {
        await supabase.from('payments').insert({
          sale_id: saleData.id,
          amount: sale.payment_amount,
          method: sale.payment_method,
          reference: sale.payment_reference,
          received_by: sale.cashier_id,
        })
      }

      await markSaleSynced(sale.local_id)
      synced++
    } catch (err: any) {
      await markSaleError(sale.local_id, err.message)
      failed++
    }
  }

  return { synced, failed }
}
