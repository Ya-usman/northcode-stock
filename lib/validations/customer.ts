import { z } from 'zod'

// Numéro de téléphone international : indicatif facultatif (+), 6 à 15
// chiffres, séparateurs usuels tolérés (espaces, points, tirets, parenthèses).
// L'application est multi-pays : plus de règle propre au Nigeria.
export const PHONE_RE = /^\+?\d{6,15}$/
export const isValidPhone = (v: string) => PHONE_RE.test(v.replace(/[\s().-]/g, ''))

interface CustomerMessages {
  name_required: string
  phone_invalid: string
  credit_limit_invalid: string
}

const defaultCustomerMessages: CustomerMessages = {
  name_required: 'Name is required',
  phone_invalid: 'Enter a valid phone number',
  credit_limit_invalid: 'Enter a valid credit limit',
}

const phoneField = (message: string) =>
  z.string().max(25).refine(v => !v || isValidPhone(v), { message }).optional().or(z.literal(''))

// Messages traduits fournis par l'appelant (t('errors.…')) ; les défauts
// anglais restent pour les usages sans traduction.
export function createCustomerSchema(msg: CustomerMessages = defaultCustomerMessages) {
  return z.object({
    name: z.string().min(1, msg.name_required).max(200),
    phone: phoneField(msg.phone_invalid),
    city: z.string().max(100).optional().or(z.literal('')),
    credit_limit: z
      .string()
      .optional()
      .or(z.literal(''))
      .refine(v => !v || (!isNaN(Number(v)) && Number(v) >= 0), { message: msg.credit_limit_invalid }),
  })
}

export const customerSchema = createCustomerSchema()

export type CustomerFormData = z.infer<typeof customerSchema>

interface SupplierMessages {
  name_required: string
  phone_invalid: string
  email_invalid: string
}

const defaultSupplierMessages: SupplierMessages = {
  name_required: 'Supplier name is required',
  phone_invalid: 'Enter a valid phone number',
  email_invalid: 'Enter a valid email address',
}

export function createSupplierSchema(msg: SupplierMessages = defaultSupplierMessages) {
  return z.object({
    name: z.string().min(1, msg.name_required).max(200),
    phone: phoneField(msg.phone_invalid),
    city: z.string().max(100).optional().or(z.literal('')),
    email: z.string().email(msg.email_invalid).optional().or(z.literal('')),
  })
}

export const supplierSchema = createSupplierSchema()

export type SupplierFormData = z.infer<typeof supplierSchema>
