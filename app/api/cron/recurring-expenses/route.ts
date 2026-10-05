import { NextResponse } from 'next/server'
import { format } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { generateDueRecurringExpenses } from '@/lib/expenses/recurring'
import { sendShopPush } from '@/lib/api/push-server'
import { writeAuditLog } from '@/lib/api/audit'

// Cron quotidien (vercel.json) : génère les dépenses récurrentes dues de
// TOUTES les boutiques, qu'une page soit ouverte ou non (décision du
// 5 oct. 2026). Même règle que /api/expenses/recurring ; l'index unique
// (template_id, date) empêche tout doublon entre les deux chemins.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const admin = await createAdminClient() as any
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data: due } = await admin.from('expenses').select('shop_id').eq('is_recurring', true).not('next_due_at', 'is', null).lte('next_due_at', today)
    const shopIds: string[] = Array.from(new Set<string>((due || []).map((r: any) => String(r.shop_id))))
    const result = await generateDueRecurringExpenses(admin, shopIds, today)
    for (const [shopId, count] of Object.entries(result.byShop)) {
      if (!count) continue
      await writeAuditLog({ action: 'expense.recurring_generated', shop_id: shopId, actor_id: null, target_id: null, target_type: 'expense', metadata: { count, source: 'cron' } })
      await sendShopPush(admin, shopId, {
        title: count > 1 ? `🔄 ${count} dépenses récurrentes générées` : '🔄 Dépense récurrente générée',
        tag: `recurring-${shopId}-${Date.now()}`, url: '/expenses',
      })
    }
    await logCronRun('recurring-expenses', 'success', { shops: shopIds.length, created: result.created })
    return NextResponse.json({ ok: true, shops: shopIds.length, created: result.created })
  } catch (e: any) {
    await logCronRun('recurring-expenses', 'error', undefined, e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
