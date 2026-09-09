import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// POST /api/admin/notify — envoyer une notification in-app à un owner
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error
    const { user } = auth

    const { shop_id, type, title, message } = await req.json()
    if (!shop_id || !title?.trim() || !message?.trim())
      return NextResponse.json({ error: 'shop_id, title et message requis' }, { status: 400 })
    if (!['info', 'warning', 'urgent'].includes(type || 'info'))
      return NextResponse.json({ error: 'type invalide' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('admin_notifications')
      .insert({ shop_id, type: type || 'info', title: title.trim(), message: message.trim() })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: shop } = await admin.from('shops').select('name').eq('id', shop_id).single()

    await writeAuditLog({
      action: 'admin.send_notification',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: shop_id,
      target_type: 'shop',
      metadata: { type: type || 'info', title: title.trim() },
      ip: getClientIp(req),
    })

    // Un message "urgent" ne doit pas dépendre du seul fait que le owner
    // ouvre l'app — filet de secours par email, comme les rappels de
    // renouvellement/péremption (mêmes Resend/expéditeur).
    if (type === 'urgent' && process.env.RESEND_API_KEY) {
      try {
        const { data: ownerMember } = await admin
          .from('shop_members').select('user_id').eq('shop_id', shop_id).eq('role', 'owner').eq('is_active', true).maybeSingle()
        if (ownerMember?.user_id) {
          const { data: ownerAuth } = await admin.auth.admin.getUserById(ownerMember.user_id)
          const ownerEmail = ownerAuth?.user?.email
          if (ownerEmail) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.stockshop.tech'
            await resend.emails.send({
              from: 'StockShop <no-reply@stockshop.tech>',
              to: ownerEmail,
              subject: `🔴 ${title.trim()} — ${shop?.name || 'StockShop'}`,
              html: `
                <p>Bonjour,</p>
                <p>Le support StockShop vous a envoyé un message urgent concernant <strong>${shop?.name || 'votre boutique'}</strong> :</p>
                <blockquote style="border-left:3px solid #dc2626;margin:12px 0;padding:8px 16px;background:#fef2f2;">
                  <strong>${title.trim()}</strong><br/>${message.trim()}
                </blockquote>
                <p><a href="${appUrl}" style="background:#073e8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Ouvrir StockShop</a></p>
              `,
            })
          }
        }
      } catch {
        // Email de secours non-bloquant — la notification in-app existe déjà
      }
    }

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// GET /api/admin/notify?shop_id=xxx — lister les notifications d'une boutique
export async function GET(req: Request) {
  try {
    const auth = await requireAdmin()
    if (auth.error) return auth.error

    const { searchParams } = new URL(req.url)
    const shop_id = searchParams.get('shop_id')
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('admin_notifications')
      .select('*')
      .eq('shop_id', shop_id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/admin/notify?id=xxx — supprimer une notification
export async function DELETE(req: Request) {
  try {
    const auth = await requireAdmin({ tier: 'super_admin' })
    if (auth.error) return auth.error

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { error } = await admin.from('admin_notifications').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
