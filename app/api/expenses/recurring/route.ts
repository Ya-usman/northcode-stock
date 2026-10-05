import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { generateDueRecurringExpenses } from '@/lib/expenses/recurring'
import { sendShopPush } from '@/lib/api/push-server'

// POST /api/expenses/recurring — { shop_id } : génère les occurrences dues
// des modèles récurrents de la boutique (appelé à l'ouverture de la page ;
// le cron du matin fait la même chose pour toutes les boutiques). Ouvrir la
// page suffit : l'intention vient du modèle créé par un rôle autorisé.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { shop_id } = await request.json()
    if (!shop_id) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canViewFeature(supabase, role, shop_id, 'expenses'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    const admin = await createAdminClient() as any
    const result = await generateDueRecurringExpenses(admin, [shop_id])
    if (result.created > 0) {
      await writeAuditLog({ action: 'expense.recurring_generated', shop_id, actor_id: user.id, actor_email: user.email, target_id: null, target_type: 'expense', metadata: { count: result.created, source: 'page' }, ip: getClientIp(request) })
      await sendShopPush(admin, shop_id, {
        title: result.created > 1 ? `🔄 ${result.created} dépenses récurrentes générées` : '🔄 Dépense récurrente générée',
        tag: `recurring-${shop_id}-${Date.now()}`, url: '/expenses',
      })
    }
    return NextResponse.json({ created: result.created })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
