// Contrôles d'une dépense — RÈGLE UNIQUE, partagée par le serveur
// (/api/expenses) et réutilisable par l'interface. Module pur.

export const EXPENSE_CATEGORY_IDS = [
  'rent', 'electricity', 'water', 'salaries', 'transport', 'supplies',
  'internet', 'maintenance', 'marketing', 'other',
] as const
export type ExpenseCategoryId = typeof EXPENSE_CATEGORY_IDS[number]

export const EXPENSE_PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer'] as const
export type ExpensePaymentMethod = typeof EXPENSE_PAYMENT_METHODS[number]

export interface ExpenseInput {
  amount: number
  description: string
  date: string
  category: ExpenseCategoryId
  payment_method: ExpensePaymentMethod
  is_recurring: boolean
  recurrence: 'weekly' | 'monthly' | null
  recurrence_day: number | null
  /** Chemin du justificatif dans l'espace privé, ou null */
  receipt_url: string | null
}

export type ExpenseValidationError =
  | 'invalid_amount' | 'description_required' | 'invalid_date'
  | 'invalid_category' | 'invalid_payment_method' | 'invalid_recurrence' | 'invalid_data'

export type ExpenseValidation = { ok: true; value: ExpenseInput } | { ok: false; error: ExpenseValidationError }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isValidDateString = (v: unknown): v is string =>
  typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(new Date(v + 'T12:00:00').getTime()) && new Date(v + 'T12:00:00').toISOString().slice(0, 10) === v

export function validateExpenseInput(body: any): ExpenseValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_data' }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return { ok: false, error: 'invalid_amount' }
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description || description.length > 500) return { ok: false, error: 'description_required' }
  if (!isValidDateString(body.date)) return { ok: false, error: 'invalid_date' }
  const category = (body.category ?? 'other') as ExpenseCategoryId
  if (!(EXPENSE_CATEGORY_IDS as readonly string[]).includes(category)) return { ok: false, error: 'invalid_category' }
  const payment_method = (body.payment_method ?? 'cash') as ExpensePaymentMethod
  if (!(EXPENSE_PAYMENT_METHODS as readonly string[]).includes(payment_method)) return { ok: false, error: 'invalid_payment_method' }
  const is_recurring = !!body.is_recurring
  let recurrence: 'weekly' | 'monthly' | null = null
  let recurrence_day: number | null = null
  if (is_recurring) {
    if (body.recurrence !== 'weekly' && body.recurrence !== 'monthly') return { ok: false, error: 'invalid_recurrence' }
    recurrence = body.recurrence
    if (recurrence === 'monthly') {
      const d = Number(body.recurrence_day)
      if (!Number.isInteger(d) || d < 1 || d > 28) return { ok: false, error: 'invalid_recurrence' }
      recurrence_day = d
    }
  }
  let receipt_url: string | null = null
  if (body.receipt_url != null && body.receipt_url !== '') {
    if (typeof body.receipt_url !== 'string' || body.receipt_url.length > 400 || body.receipt_url.includes('..')) return { ok: false, error: 'invalid_data' }
    receipt_url = body.receipt_url
  }
  return { ok: true, value: { amount: Math.round(amount * 100) / 100, description, date: body.date, category, payment_method, is_recurring, recurrence, recurrence_day, receipt_url } }
}

/** Budget mensuel d'une catégorie */
export function validateBudgetInput(body: any): { ok: true; category: ExpenseCategoryId; amount: number } | { ok: false; error: 'invalid_category' | 'invalid_amount' } {
  const category = body?.category as ExpenseCategoryId
  if (!(EXPENSE_CATEGORY_IDS as readonly string[]).includes(category)) return { ok: false, error: 'invalid_category' }
  const amount = Number(body?.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return { ok: false, error: 'invalid_amount' }
  return { ok: true, category, amount: Math.round(amount * 100) / 100 }
}
