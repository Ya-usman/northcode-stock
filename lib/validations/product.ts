import { z } from 'zod'

interface ValidationMessages {
  product_name_required: string
  selling_price_required: string
  buying_price_invalid: string
  quantity_invalid: string
  restock_min_qty: string
}

const defaultMessages: ValidationMessages = {
  product_name_required: 'Product name is required',
  selling_price_required: 'Selling price must be > 0',
  buying_price_invalid: 'Buying price must be ≥ 0',
  quantity_invalid: 'Quantity must be ≥ 0',
  restock_min_qty: 'Must add at least 1',
}

export function createProductSchema(msg: ValidationMessages = defaultMessages) {
  return z.object({
    name: z.string().min(1, msg.product_name_required).max(200),
    name_hausa: z.string().max(200).optional().or(z.literal('')),
    category_id: z.string().uuid().optional().or(z.literal('')),
    supplier_id: z.string().uuid().optional().or(z.literal('')),
    buying_price: z.coerce.number().min(0, msg.buying_price_invalid),
    selling_price: z.coerce.number().min(1, msg.selling_price_required),
    quantity: z.coerce.number().int().min(0, msg.quantity_invalid),
    unit: z.string().min(1).default('piece'),
    low_stock_threshold: z.coerce.number().int().min(0).optional(),
    sku: z.string().max(100).optional().or(z.literal('')),
    image_url: z.string().url().optional().or(z.literal('')),
    is_active: z.boolean().default(true),
  })
}

export const productSchema = createProductSchema()

export type ProductFormData = z.infer<ReturnType<typeof createProductSchema>>

export function createRestockSchema(msg: Pick<ValidationMessages, 'restock_min_qty'> = defaultMessages) {
  return z.object({
    product_id: z.string().uuid(),
    quantity: z.coerce.number().int().min(1, msg.restock_min_qty),
    buying_price: z.coerce.number().min(0).optional(),
    supplier_id: z.string().uuid().optional().or(z.literal('')),
    notes: z.string().max(500).optional(),
  })
}

export const restockSchema = createRestockSchema()

export type RestockFormData = z.infer<typeof restockSchema>

export const adjustStockSchema = z.object({
  product_id: z.string().uuid(),
  adjustment: z.coerce.number().int(),
  reason: z.enum(['damage', 'loss', 'theft', 'expiry', 'correction', 'other']),
  notes: z.string().max(500).optional(),
})

export type AdjustStockFormData = z.infer<typeof adjustStockSchema>
