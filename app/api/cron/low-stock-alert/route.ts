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

    // All shops — we need push AND email columns
    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name, owner_id, currency, low_stock_threshold, notify_push_low_stock, notify_email_low_stock')

    if (shopsError) throw new Error(shopsError.message)
    if (!shops?.length) return NextResponse.json({ ok: true, shops: 0 })

    const results: Record<string, any> = {}

    for (const shop of shops) {
      const threshold = shop.low_stock_threshold ?? 10

      // Products below threshold
      const { data: lowProducts } = await admin
        .from('products')
        .select('id, name, name_hausa, quantity, unit, low_stock_threshold')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .lte('quantity', threshold)

      const alerts = (lowProducts ?? []).filter((p: any) => p.quantity <= (p.low_stock_threshold ?? threshold))

      if (!alerts.length) {
        results[shop.name] = { alerts: 0 }
        continue
      }

      const outOfStock = alerts.filter((p: any) => p.quantity === 0)
      const lowStock = alerts.filter((p: any) => p.quantity > 0)
      results[shop.name] = { alerts: alerts.length, push: 'skipped', email: 'skipped' }

      // --- PUSH NOTIFICATION ---
      if (shop.notify_push_low_stock) {
        const { data: subs } = await admin
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('shop_id', shop.id)

        if (subs?.length) {
          let body = ''
          if (outOfStock.length === 1) body += `${outOfStock[0].name} est épuisé. `
          else if (outOfStock.length > 1) body += `${outOfStock.length} produits épuisés. `
          if (lowStock.length === 1) body += `${lowStock[0].name} : stock bas (${lowStock[0].quantity}).`
          else if (lowStock.length > 1) body += `${lowStock.length} produits en stock bas.`

          const payload = JSON.stringify({
            title: `⚠️ ${shop.name} — Alerte stock`,
            body: body.trim(),
            tag: `low-stock-${shop.id}`,
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

          // Clean up expired subscriptions (410 Gone)
          const expired = subs
            .filter((_: any, i: number) => {
              const r = pushResults[i]
              return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
            })
            .map((s: any) => s.endpoint)
          if (expired.length) {
            await admin.from('push_subscriptions').delete().in('endpoint', expired)
          }

          const sent = pushResults.filter(r => r.status === 'fulfilled').length
          results[shop.name].push = `${sent}/${subs.length} sent`
        }
      }

      // --- EMAIL ALERT ---
      if (shop.notify_email_low_stock && shop.owner_id) {
        const { data: ownerData } = await admin.auth.admin.getUserById(shop.owner_id)
        const ownerEmail = ownerData?.user?.email

        if (ownerEmail) {
          const sym = shop.currency || 'F CFA'
          const dateStr = new Date().toLocaleDateString('fr-FR', { dateStyle: 'full' })

          const { error: sendError } = await resend.emails.send({
            from: 'StockShop <onboarding@resend.dev>',
            to: ownerEmail,
            subject: `🔴 Alerte stock — ${shop.name} (${alerts.length} produit${alerts.length > 1 ? 's' : ''})`,
            html: buildLowStockEmailHtml(shop.name, dateStr, outOfStock, lowStock, threshold, sym),
          })

          results[shop.name].email = sendError ? `error: ${sendError.message}` : 'sent'
        } else {
          results[shop.name].email = 'no_owner_email'
        }
      }
    }

    return NextResponse.json({ ok: true, shops: shops.length, results })
  } catch (err: any) {
    console.error('[cron/low-stock-alert]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

function buildLowStockEmailHtml(
  shopName: string,
  dateStr: string,
  outOfStock: any[],
  lowStock: any[],
  defaultThreshold: number,
  currency: string
): string {
  const outRows = outOfStock.map(p => `
    <div style="background:#fff;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="font-weight:600;color:#374151;font-size:14px;">${p.name}${p.name_hausa ? ` <span style="color:#9ca3af;font-size:12px;">(${p.name_hausa})</span>` : ''}</div>
      <div style="margin-top:4px;">
        <span style="display:inline-block;background:#fee2e2;color:#dc2626;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">RUPTURE DE STOCK</span>
      </div>
    </div>`).join('')

  const lowRows = lowStock.map(p => {
    const t = p.low_stock_threshold ?? defaultThreshold
    return `
    <div style="background:#fff;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:12px 14px;margin-bottom:8px;">
      <div style="font-weight:600;color:#374151;font-size:14px;">${p.name}${p.name_hausa ? ` <span style="color:#9ca3af;font-size:12px;">(${p.name_hausa})</span>` : ''}</div>
      <div style="margin-top:4px;">
        <span style="display:inline-block;background:#fef3c7;color:#d97706;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;">
          ${p.quantity} ${p.unit ?? 'unité(s)'} restant(s) · seuil: ${t}
        </span>
      </div>
    </div>`
  }).join('')

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
    <tr><td style="background:linear-gradient(135deg,#b91c1c 0%,#dc2626 100%);padding:28px 32px 24px;">
      <p style="margin:0 0 4px;color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;">Alerte stock</p>
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">🔴 ${shopName}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">${dateStr}</p>
    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:24px 32px;">

      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:24px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#dc2626;">${outOfStock.length + lowStock.length}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">produit(s) nécessitent un réapprovisionnement</div>
      </div>

      ${outOfStock.length > 0 ? `
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;">❌ Rupture de stock (${outOfStock.length})</p>
      ${outRows}
      <div style="height:16px;"></div>` : ''}

      ${lowStock.length > 0 ? `
      <p style="margin:0 0 10px;font-size:12px;font-weight:600;color:#d97706;text-transform:uppercase;letter-spacing:0.5px;">⚠️ Stock faible (${lowStock.length})</p>
      ${lowRows}` : ''}

      <div style="margin-top:24px;text-align:center;">
        <a href="https://stockshop.tech/fr/stock" style="display:inline-block;background:#073e8a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
          Gérer le stock →
        </a>
      </div>

    </td></tr></table>

    <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="background:#f9fafb;border-top:3px solid #D4AF37;padding:14px 32px;">
      <p style="margin:0;color:#9ca3af;font-size:11px;text-align:center;">StockShop · Alerte automatique de stock faible</p>
    </td></tr></table>

  </td></tr>
</table>
</td></tr></table>
</body></html>`
}
