import { createAdminClient } from '@/lib/supabase/server'

export type AuditAction =
  | 'member.invite'
  | 'member.delete'
  | 'member.role_change'
  | 'permissions.update'
  | 'billing.subscribe'
  | 'billing.verify'
  | 'account.register'
  | 'account.delete'
  | 'sale.cancel'
  | 'sale.delete'
  | 'admin.suspend_shop'
  | 'admin.reactivate_shop'
  | 'admin.extend_access'
  | 'admin.grant_plan'
  | 'admin.edit_shop'
  | 'admin.restore_product'
  | 'admin.restore_customer'
  | 'admin.create_owner'

interface AuditParams {
  action: AuditAction
  shop_id?: string | null
  actor_id?: string | null
  actor_email?: string | null
  target_id?: string | null
  target_type?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    const admin = await createAdminClient()
    await (admin as any).from('audit_logs').insert({
      shop_id:      params.shop_id ?? null,
      actor_id:     params.actor_id ?? null,
      actor_email:  params.actor_email ?? null,
      action:       params.action,
      target_id:    params.target_id ?? null,
      target_type:  params.target_type ?? null,
      metadata:     params.metadata ?? {},
      ip:           params.ip ?? null,
    })
  } catch {
    // Never block the main request if audit logging fails
  }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
