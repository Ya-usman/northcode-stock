import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

export async function POST(request: Request) {
  try {
    const { expense_id, shop_id } = await request.json()

    if (!expense_id || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Verify caller is an active member with delete permission
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const callerRole = callerMember?.role
    if (!callerRole || !['owner', 'manager', 'shop_manager', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = createAdminClient() as any

    // Fetch expense details before deletion so we can store them in the audit log
    const { data: expense, error: fetchError } = await admin
      .from('expenses')
      .select('amount, category, description, date, is_recurring')
      .eq('id', expense_id)
      .eq('shop_id', shop_id)
      .single()

    if (fetchError || !expense) {
      return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 })
    }

    // Delete
    const { error: deleteError } = await admin
      .from('expenses')
      .delete()
      .eq('id', expense_id)
      .eq('shop_id', shop_id)

    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

    // Write audit log — never blocks the response
    await writeAuditLog({
      action: 'expense.delete',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: expense_id,
      target_type: 'expense',
      metadata: {
        amount: expense.amount,
        category: expense.category,
        description: expense.description,
        date: expense.date,
        is_recurring: expense.is_recurring,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
