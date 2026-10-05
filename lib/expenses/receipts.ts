// Justificatifs de dépenses — espace PRIVÉ `expense-receipts` (migration 156).
// Le chemin stocké dans expenses.receipt_url est « <shop_id>/<fichier> » ;
// l'image est servie par /api/expenses/receipt?path=… (lien signé, 1 h).
export const RECEIPT_BUCKET = 'expense-receipts'
export const RECEIPT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const RECEIPT_MAX_MB = 8

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function receiptShopId(path: string): string | null {
  const first = path.split('/')[0]
  return first && UUID.test(first) ? first : null
}

export function isReceiptPathOfShop(path: string, shopId: string): boolean {
  return !path.includes('..') && !path.startsWith('http') && receiptShopId(path) === shopId && path.length <= 400
}

/** Adresse à donner à <img> / <a> pour un justificatif stocké (ou une URL publique ancienne) */
export function receiptSrc(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.startsWith('http') || stored.startsWith('blob:') || stored.startsWith('data:')) return stored
  return `/api/expenses/receipt?path=${encodeURIComponent(stored)}`
}
