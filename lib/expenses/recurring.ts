// Dépenses récurrentes — génération PAR LE SERVEUR (lot 2, 5 oct. 2026).
// Avant : le navigateur générait les occurrences à l'ouverture de la page
// (doublons possibles entre deux appareils, rien sans ouverture). Ici :
// une seule règle, appelée par /api/expenses/recurring (ouverture de la
// page) et par le cron du matin (/api/cron/recurring-expenses). L'index
// unique (template_id, date) de la migration 156 rend le doublon impossible.
import { addMonths, addWeeks, format } from 'date-fns'

export function advanceNextDue(dateStr: string, recurrence: 'weekly' | 'monthly', day?: number | null): string {
  const d = new Date(dateStr + 'T12:00:00')
  if (recurrence === 'monthly') {
    const next = addMonths(d, 1)
    if (day) next.setDate(Math.min(day, 28))
    return format(next, 'yyyy-MM-dd')
  }
  return format(addWeeks(d, 1), 'yyyy-MM-dd')
}

/** Garde-fou : un modèle laissé 10 ans sans ouverture ne génère pas 500 lignes d'un coup */
const MAX_OCCURRENCES_PER_TEMPLATE = 120

export interface RecurringResult { created: number; byShop: Record<string, number> }

export async function generateDueRecurringExpenses(admin: any, shopIds: string[], today = format(new Date(), 'yyyy-MM-dd')): Promise<RecurringResult> {
  const result: RecurringResult = { created: 0, byShop: {} }
  if (!shopIds.length) return result
  const { data: due } = await admin.from('expenses')
    .select('id, shop_id, amount, description, category, payment_method, recurrence, recurrence_day, next_due_at, created_by')
    .in('shop_id', shopIds).eq('is_recurring', true).not('next_due_at', 'is', null).lte('next_due_at', today)
  for (const tpl of due || []) {
    if (tpl.recurrence !== 'weekly' && tpl.recurrence !== 'monthly') continue
    const rows: any[] = []
    let dueDate: string = tpl.next_due_at
    while (dueDate <= today && rows.length < MAX_OCCURRENCES_PER_TEMPLATE) {
      rows.push({
        shop_id: tpl.shop_id, amount: tpl.amount, description: tpl.description,
        category: tpl.category ?? 'other', payment_method: tpl.payment_method ?? 'cash',
        date: dueDate, is_recurring: false, template_id: tpl.id, created_by: tpl.created_by ?? null,
      })
      dueDate = advanceNextDue(dueDate, tpl.recurrence, tpl.recurrence_day)
    }
    if (!rows.length) continue
    // ON CONFLICT (template_id, date) DO NOTHING : seules les lignes réellement créées reviennent
    const { data: inserted, error } = await admin.from('expenses')
      .upsert(rows, { onConflict: 'template_id,date', ignoreDuplicates: true }).select('id')
    if (error) throw new Error(error.message)
    const n = (inserted || []).length
    result.created += n
    result.byShop[tpl.shop_id] = (result.byShop[tpl.shop_id] || 0) + n
    await admin.from('expenses').update({ next_due_at: dueDate, updated_at: new Date().toISOString() }).eq('id', tpl.id)
  }
  return result
}
