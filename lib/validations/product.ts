import { z } from 'zod'

export const productSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  name_hausa: z.string().max(200).optional().or(z.literal('')),
  sku: z.string().max(50).optional().or(z.literal('')),
  category_id: z.string().uuid().optional().or(z.literal('')),
  supplier_id: z.string().uuid().optional().or(z.literal('')),
  buying_price: z.coerce.number().min(0, 'Buying price must be ≥ 0'),
  selling_price: z.coerce.number().min(1, 'Selling price must be > 0'),
  quantity: z.coerce.number().int().min(0, 'Quantity must be ≥ 0'),
  unit: z.string().min(1).default('piece'),
  low_stock_threshold: z.coerce.number().int().min(0).optional(),
  image_url: z.string().url().optional().or(z.literal('')),
  is_active: z.boolean().default(true),
})

export type ProductFormData = z.infer<typeof productSchema>

export const restockSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1, 'Must add at least 1'),
  buying_price: z.coerce.number().min(0).optional(),
  supplier_id: z.string().uuid().optional().or(z.literal('')),
  notes: z.string().max(500).optional(),
})

export type RestockFormData = z.infer<typeof restockSchema>

export const adjustStockSchema = z.object({
  product_id: z.string().uuid(),
  adjustment: z.coerce.number().int(),
  reason: z.enum(['damage', 'loss', 'theft', 'expiry', 'correction', 'other']),
  notes: z.string().max(500).optional(),
})

export type AdjustStockFormData = z.infer<typeof adjustStockSchema>
