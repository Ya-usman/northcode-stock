import { z } from 'zod'

export const saleSchema = z.object({
  customer_id: z.string().uuid().optional().or(z.literal('')),
  discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0),
  payment_method: z.enum(['cash', 'transfer', 'credit', 'paystack']),
  amount_paid: z.coerce.number().min(0),
  notes: z.string().max(500).optional(),
  // Transfer fields
  bank_name: z.string().optional(),
  transfer_reference: z.string().optional(),
  // Paystack
  paystack_reference: z.string().optional(),
})

export type SaleFormData = z.infer<typeof saleSchema>

export const cartItemSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1),
  unit_price: z.coerce.number().min(0),
})

export const paymentSchema = z.object({
  sale_id: z.string().uuid(),
  amount: z.coerce.number().min(1, 'Amount must be > 0'),
  method: z.enum(['cash', 'transfer', 'paystack']),
  reference: z.string().optional(),
})

export type PaymentFormData = z.infer<typeof paymentSchema>
