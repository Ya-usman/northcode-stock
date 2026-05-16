import { NextResponse } from 'next/server'
import { z } from 'zod'

export const uuid = z.string().uuid()
export const email = z.string().email().max(254)
export const shortText = z.string().min(1).max(100)
export const positiveNumber = z.number().positive()
export const nonNegativeNumber = z.number().min(0)

export const roleEnum = z.enum(['manager', 'cashier', 'stock_manager', 'viewer'])
export const billingPeriodEnum = z.enum(['monthly', 'quarterly', 'annual'])
export const planEnum = z.enum(['starter', 'pro', 'business'])

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export function validateBody<T>(schema: z.ZodSchema<T>, data: unknown): { data: T } | { error: NextResponse } {
  const result = schema.safeParse(data)
  if (!result.success) {
    const message = result.error.errors[0]?.message || 'Données invalides'
    return { error: badRequest(message) }
  }
  return { data: result.data }
}
