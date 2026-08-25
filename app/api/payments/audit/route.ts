import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'

// GET /api/payments/audit?shop_id= — journal of credit-related actions
// (cancel/edit a payment, write off a debt, postpone a due date) for the
// Crédit tab's "Journal" view. A dedicated route (admin client) rather than
// a direct browser query is needed because the audit_logs RLS policy
// (audit_owner_read, migration 050) only grants SELECT to shop owners —
// this page's credit-management actions are also open to manager/shop_manager,
// so their journal visibility must match that, not the stricter RLS policy.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    if (!shop_id) return NextResponse.json({ error: t('missing_params') }, { status: 400 })

    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const isManagerial = memberRow && ['owner', 'manager', 'shop_manager', 'super_admin'].includes(memberRow.role)
    if (!isManagerial) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('audit_logs')
      .select('*')
      .eq('shop_id', shop_id)
      .in('action', ['payment.cancel', 'payment.edit', 'payment.write_off', 'sale.postpone_due_date'])
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error
    return NextResponse.json({ logs: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
