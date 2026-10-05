import webpush from 'web-push'

// VAPID keys can be unset in some environments (local dev, preview deploys
// without push configured) — calling web-push without them throws
// immediately, turning every push attempt into a 500 even for actions
// (a sale, an expense) that otherwise succeeded. Push is a best-effort
// notification layer, never something a caller should fail on — routes call
// this first and skip sending (not throw) when it returns false.
export function configureWebPush(): boolean {
  const { VAPID_MAILTO, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_MAILTO || !NEXT_PUBLIC_VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(VAPID_MAILTO, NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}

/**
 * Envoie une notification à tous les appareils abonnés d'une boutique
 * (client admin). Jamais bloquant : renvoie le nombre d'envois réussis, 0 si
 * la poussée n'est pas configurée. Les abonnements expirés (410) sont retirés.
 */
export async function sendShopPush(admin: any, shopId: string, payload: { title: string; body?: string; tag?: string; url?: string }): Promise<number> {
  try {
    if (!configureWebPush()) return 0
    const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('shop_id', shopId)
    if (!subs?.length) return 0
    const body = JSON.stringify({ body: '', ...payload })
    const results = await Promise.allSettled(subs.map((sub: any) =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body)))
    const expired = subs.filter((_: any, i: number) => results[i].status === 'rejected' && ((results[i] as PromiseRejectedResult).reason as any)?.statusCode === 410).map((s: any) => s.endpoint)
    if (expired.length) await admin.from('push_subscriptions').delete().in('endpoint', expired)
    return results.filter(r => r.status === 'fulfilled').length
  } catch {
    return 0
  }
}
