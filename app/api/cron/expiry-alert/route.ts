import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_MAILTO!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )

    const admin = await createAdminClient() as any

    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name, owner_id, currency, expiry_alert_days, notify_push_expiry, notify_email_expiry')

    if (shopsError) throw new Error(shopsError.message)
    if (!shops?.length) return NextResponse.json({ ok: true, shops: 0 })

    const results: Record<string, any> = {}
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)

    for (const shop of shops) {
      const alertDays = shop.expiry_alert_days ?? 14
      const cutoff = new Date(today.getTime() + alertDays * 86_400_000)
      const cutoffStr = cutoff.toISOString().slice(0, 10)

      // Batches expiring within the window, still in stock
      const { data: batches } = await admin
        .from('product_batches')
        .select('product_id, quantity, expiry_date, products(name, name_hausa, unit)')
        .eq('shop_id', shop.id)
        .gt('quantity', 0)
        .not('expiry_date', 'is', null)
        .lte('expiry_date', cutoffStr)

      // Collapse multiple batches of the same product into one alert row —
      // keep the earliest expiry date, sum the affected quantity.
      const grouped: Record<string, { product_id: string; name: string; name_hausa: string | null; unit: string | null; quantity: number; expiry_date: string }> = {}
      for (const b of batches ?? []) {
        const p = b.products
        const existing = grouped[b.product_id]
        if (!existing || b.expiry_date < existing.expiry_date) {
          grouped[b.product_id] = {
            product_id: b.product_id,
            name: p?.name ?? '—',
            name_hausa: p?.name_hausa ?? null,
            unit: p?.unit ?? null,
            quantity: (existing?.quantity ?? 0) + b.quantity,
            expiry_date: b.expiry_date,
          }
        } else {
          existing.quantity += b.quantity
        }
      }
      const alerts = Object.values(grouped)

      if (!alerts.length) {
        results[shop.name] = { alerts: 0 }
        continue
      }

      const expired = alerts.filter(a => a.expiry_date < todayStr)
      const expiringSoon = alerts.filter(a => a.expiry_date >= todayStr)
      results[shop.name] = { alerts: alerts.length, push: 'skipped', email: 'skipped' }

      // --- PUSH NOTIFICATION ---
      if (shop.notify_push_expiry) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('shop_id', shop.id)

        if (subs?.length) {
          let body = ''
          if (expired.length === 1) body += `${expired[0].name} est périmé. `
          else if (expired.length > 1) body += `${expired.length} produits périmés. `
          if (expiringSoon.length === 1) body += `${expiringSoon[0].name} périme bientôt.`
          else if (expiringSoon.length > 1) body += `${expiringSoon.length} produits périment bientôt.`

          const payload = JSON.stringify({
            title: `⏳ ${shop.name} — Alerte péremption`,
            body: body.trim(),
            tag: `expiry-${shop.id}`,
            url: '/stock',
          })

          const pushResults = await Promise.allSettled(
            subs.map((sub: any) =>
              webpush.sendNotification(
                { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                payload
              )
            )
          )

          const expiredSubs = subs
            .filter((_: any, i: number) => {
              const r = pushResults[i]
              return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
            })
            .map((s: any) => s.endpoint)
          if (expiredSubs.length) {
            await admin.from('push_subscriptions').delete().in('endpoint', expiredSubs)
          }

          const sent = pushResults.filter(r => r.status === 'fulfilled').length
          results[shop.name].push = `${sent}/${subs.length} sent`
        }
      }

      // --- EMAIL ALERT ---
      if (shop.notify_email_expiry && shop.owner_id && /^[0-9a-f-]{36}$/.test(shop.owner_id)) {
        const { data: ownerData } = await admin.auth.admin.getUserById(shop.owner_id)
        const ownerEmail = ownerData?.user?.email

        if (ownerEmail) {
          const dateStr = new Date().toLocaleDateString('fr-FR', { dateStyle: 'full' })

          const { error: sendError } = await resend.emails.send({
            from: 'StockShop <onboarding@resend.dev>',
            to: ownerEmail,
            subject: `⏳ Alerte péremption — ${shop.name} (${alerts.length} produit${alerts.length > 1 ? 's' : ''})`,
            html: buildExpiryEmailHtml(shop.name, dateStr, expired, expiringSoon),
          })

          results[shop.name].email = sendError ? `error: ${sendError.message}` : 'sent'
        } else {
          results[shop.name].email = 'no_owner_email'
        }
      }
    }

    return NextResponse.json({ ok: true, shops: shops.length, results })
  } catch (err: any) {
    console.error('[cron/expiry-alert]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildExpiryEmailHtml(
  shopName: string,
  dateStr: string,
  expired: any[],
  expiringSoon: any[]
): string {
  const expiredRows = expired.map(p => `
    <div style="background:#fff;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="font-weight:600;color:#374151;font-size:14px;">${p.name}${p.name_hausa ? ` <span style="color:#9ca3af;font-size:12px;">(${p.name_hausa})</span>` : ''}</div>
      <div style="margin-top:4px;">
        <span style="display:inline-block;background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">
          PÉRIMÉ LE ${fmtDate(p.expiry_date)} · ${p.quantity} ${p.unit ?? 'unité(s)'}
        </span>
      </div>
    </div>`).join('')

  const soonRows = expiringSoon.map(p => `
    <div style="background:#fff;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="font-weight:600;color:#374151;font-size:14px;">${p.name}${p.name_hausa ? ` <span style="color:#9ca3af;font-size:12px;">(${p.name_hausa})</span>` : ''}</div>
      <div style="margin-top:4px;">
        <span style="display:inline-block;background:#fef3c7;color:#d97706;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">
          PÉRIME LE ${fmtDate(p.expiry_date)} · ${p.quantity} ${p.unit ?? 'unité(s)'}
        </span>
      </div>
    </div>`).join('')

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:32px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

  <tr><td align="center" style="padding-bottom:20px;">
    <table cellpadding="0" cellspacing="0"><tr>
      <td style="background:#073e8a;border-radius:12px;padding:10px 22px;">
        <span style="color:#fff;font-size:17px;font-weight:700;">StockShop</span>
        <span style="color:#D4AF37;font-size:17px;font-weight:700;">.</span>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(7,62,138,0.08);overflow:hidden;">

    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:linear-gradient(135deg,#b45309 0%,#d97706 100%);padding:28px 32px 24px;">
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">Alerte péremption</p>
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">⏳ ${shopName}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${dateStr}</p>
    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 32px;">

      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;margin-bottom:24px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#d97706;">${expired.length + expiringSoon.length}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">produit(s) périmé(s) ou proche de la péremption</div>
      </div>

      ${expired.length > 0 ? `
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">❌ Déjà périmés (${expired.length})</p>
      ${expiredRows}
      <div style="height:16px;"></div>` : ''}

      ${expiringSoon.length > 0 ? `
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">⚠️ Bientôt périmés (${expiringSoon.length})</p>
      ${soonRows}` : ''}

      ${expiringSoon.length > 0 ? `
      <p style="margin:16px 0 0;font-size:12px;color:#6b7280;text-align:center;">
        Astuce : une promotion temporaire sur ces produits peut aider à écouler le stock avant la date limite.
      </p>` : ''}

      <div style="margin-top:16px;text-align:center;">
        <a href="https://stockshop.tech/fr/stock" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
          Gérer le stock et les promotions →
        </a>
      </div>

    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#f9fafb;border-top:3px solid #D4AF37;padding:14px 32px;">
      <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">StockShop · Alerte automatique de péremption</p>
    </td></tr></table>

  </td></tr>
</table>
</td></tr></table>
</body></html>`
}
