import { z } from 'zod'

export const customerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone: z
    .string()
    .max(20)
    .regex(/^(\+?234|0)?[789]\d{9}$/, 'Enter a valid Nigerian phone number')
    .optional()
    .or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
})

export type CustomerFormData = z.infer<typeof customerSchema>

export const supplierSchema = z.object({
  name: z.string().min(1, 'Supplier name is required').max(200),
  phone: z
    .string()
    .max(20)
    .regex(/^(\+?234|0)?[789]\d{9}$/, 'Enter a valid Nigerian phone number')
    .optional()
    .or(z.literal('')),
  city: z.string().max(100).optional().or(z.literal('')),
})

export type SupplierFormData = z.infer<typeof supplierSchema>
