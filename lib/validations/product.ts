import { z } from 'zod'
import { SKU_MAX_LENGTH } from '@/lib/import/products-import'

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
    // Mêmes règles que le serveur (lib/import/products-import checkProductFields) : nom nettoyé, prix de vente > 0
    name: z.string().trim().min(1, msg.product_name_required).max(200),
    category_id: z.string().uuid().optional().or(z.literal('')),
    supplier_id: z.string().uuid().optional().or(z.literal('')),
    buying_price: z.coerce.number().min(0, msg.buying_price_invalid),
    selling_price: z.coerce.number().positive(msg.selling_price_required),
    quantity: z.coerce.number().int().min(0, msg.quantity_invalid),
    unit: z.string().min(1).default('piece'),
    // Vide = seuil de la boutique (null) ; 0 = pas d'alerte « stock faible » (règle du 1er nov. 2026)
    low_stock_threshold: z.preprocess(v => (v === '' || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).nullable()).optional(),
    sku: z.string().max(SKU_MAX_LENGTH).optional().or(z.literal('')),
    image_url: z.string().url().optional().or(z.literal('')),
    is_active: z.boolean().default(true),
    /** Date de péremption du LOT initial (création avec stock > 0) — jamais une propriété du produit */
    expiry_date: z.string().optional().or(z.literal('')),
    /** Emplacement dans la boutique (étape 10, migration 196) : texte libre, facultatif */
    location: z.string().max(60).optional().or(z.literal('')),
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
    expiry_date: z.string().optional().or(z.literal('')),
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
