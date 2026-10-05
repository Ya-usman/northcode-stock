// Champs d'identité d'une boutique (migration 152) : code, adresse, téléphone,
// e-mail. Tous FACULTATIFS. Validation unique partagée par la création
// (POST /api/shops) et la modification (PATCH /api/shops/settings), et par le
// formulaire (mêmes règles côté interface).

import { isValidPhone } from '@/lib/validations/customer'

export const SHOP_IDENTITY_FIELDS = ['code', 'address', 'phone', 'email'] as const
export type ShopIdentityField = typeof SHOP_IDENTITY_FIELDS[number]

export const SHOP_CODE_RE = /^[A-Za-z0-9_-]{1,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Clé d'erreur (bloc api_errors) par champ, ou null si valide */
export function validateShopIdentity(raw: Partial<Record<ShopIdentityField, unknown>>): {
  values: Partial<Record<ShopIdentityField, string | null>>
  errors: Partial<Record<ShopIdentityField, string>>
} {
  const values: Partial<Record<ShopIdentityField, string | null>> = {}
  const errors: Partial<Record<ShopIdentityField, string>> = {}
  for (const field of SHOP_IDENTITY_FIELDS) {
    if (!(field in raw)) continue
    const v = raw[field]
    if (v !== null && v !== undefined && typeof v !== 'string') { errors[field] = `shop_${field}_invalid`; continue }
    const clean = typeof v === 'string' ? v.trim() : ''
    if (!clean) { values[field] = null; continue }
    if (field === 'code') {
      const code = clean.toUpperCase()
      if (!SHOP_CODE_RE.test(code)) errors.code = 'shop_code_invalid'
      else values.code = code
    } else if (field === 'address') {
      if (clean.length > 200) errors.address = 'shop_address_too_long'
      else values.address = clean
    } else if (field === 'phone') {
      if (clean.length > 30 || !isValidPhone(clean)) errors.phone = 'shop_phone_invalid'
      else values.phone = clean
    } else if (field === 'email') {
      if (clean.length > 254 || !EMAIL_RE.test(clean)) errors.email = 'shop_email_invalid'
      else values.email = clean.toLowerCase()
    }
  }
  return { values, errors }
}

/**
 * Code déjà utilisé par une AUTRE boutique non supprimée du même compte ?
 * (le compte = boutiques où le propriétaire a une affectation « owner »).
 * Complète l'index unique (owner_id, code) de la migration 152, qui ne couvre
 * pas les boutiques dont shops.owner_id est vide.
 */
export async function isShopCodeTaken(admin: any, ownerShopIds: string[], code: string, excludeShopId?: string): Promise<boolean> {
  if (!ownerShopIds.length) return false
  const { data, error } = await admin.from('shops').select('id, code').in('id', ownerShopIds).is('deleted_at', null)
  if (error) return false // colonne absente avant la migration 152 : l'écriture échouera proprement plus loin
  return (data || []).some((s: any) => s.id !== excludeShopId && typeof s.code === 'string' && s.code.trim().toUpperCase() === code)
}
