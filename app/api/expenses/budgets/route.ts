import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { validateBudgetInput, EXPENSE_CATEGORY_IDS } from '@/lib/validations/expense'

// Budgets mensuels par catégorie — PAR LE SERVEUR (lot 2). Droit « Dépenses »
// en modification. PUT = définir (création ou mise à jour), DELETE = retirer.

async function authorize(request: Request, shop_id: string) {
  const t = getApiTranslator(request)
  const { user, supabase } = await getAuthedUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (!shop_id) return { error: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shop_id)
  if (!role || !(await canWriteFeature(supabase, role, shop_id, 'expenses'))) {
    return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  }
  return { user, t }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const auth = await authorize(request, body?.shop_id)
    if ('error' in auth) return auth.error
    const check = validateBudgetInput(body)
    if (!check.ok) return NextResponse.json({ error: auth.t(check.error as any), code: check.error }, { status: 400 })
    const admin = await createAdminClient() as any
    const { data, error } = await admin.from('expense_budgets')
      .upsert({ shop_id: body.shop_id, category: check.category, amount: check.amount, updated_at: new Date().toISOString() }, { onConflict: 'shop_id,category' })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writeAuditLog({ action: 'budget.set', shop_id: body.shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: data.id, target_type: 'expense_budget', metadata: { category: check.category, amount: check.amount }, ip: getClientIp(request) })
    return NextResponse.json({ budget: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id') || ''
    const category = searchParams.get('category') || ''
    const auth = await authorize(request, shop_id)
    if ('error' in auth) return auth.error
    if (!(EXPENSE_CATEGORY_IDS as readonly string[]).includes(category)) return NextResponse.json({ error: auth.t('invalid_category') }, { status: 400 })
    const admin = await createAdminClient() as any
    const { error } = await admin.from('expense_budgets').delete().eq('shop_id', shop_id).eq('category', category)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    await writeAuditLog({ action: 'budget.delete', shop_id, actor_id: auth.user.id, actor_email: auth.user.email, target_id: null, target_type: 'expense_budget', metadata: { category }, ip: getClientIp(request) })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
