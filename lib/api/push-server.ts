import webpush from 'web-push'
import { resolvePermission, type PermFeature, type StoredPermissions } from '@/lib/permissions'

// ── Sécurité des notifications (29 oct. 2026) ─────────────────────────────────────────────────────────────────────
// Avant : n'importe quel compte connecté pouvait s'abonner aux notifications d'une boutique dont il n'est pas membre,
// et déclencher des envois (avec un texte de son choix) vers n'importe quelle boutique ; un membre retiré gardait son
// abonnement. Désormais :
//   • s'abonner / déclencher : membre actif de la boutique (routes /api/push/*, via checkShopRole) ;
//   • recevoir : membres ACTUELS (propriétaire compris) qui ont le droit de voir l'information, mêmes règles que les
//     écrans (pushRecipients) — un abonnement d'un membre retiré n'est plus servi.

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
export async function sendShopPush(admin: any, shopId: string, payload: { title: string; body?: string; tag?: string; url?: string }, feature?: PermFeature): Promise<number> {
  try {
    if (!configureWebPush()) return 0
    const allowed = await pushRecipients(admin, shopId, { feature })
    const { data: rows } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').eq('shop_id', shopId)
    const subs = onlyAllowed(rows, allowed)
    if (!subs.length) return 0
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

/**
 * Notification aux appareils de CERTAINES personnes d'une boutique (ex. ceux qui peuvent accepter une demande de
 * prolongation), et non à tous les abonnés. Jamais bloquant ; renvoie le nombre d'envois réussis.
 */
export async function sendUsersPush(admin: any, shopId: string, userIds: string[], payload: { title: string; body?: string; tag?: string; url?: string }): Promise<number> {
  try {
    if (!userIds.length || !configureWebPush()) return 0
    const allowed = await pushRecipients(admin, shopId)
    const { data: rows } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').eq('shop_id', shopId).in('user_id', userIds)
    const subs = onlyAllowed(rows, allowed)
    if (!subs.length) return 0
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

/**
 * Personnes qui peuvent RECEVOIR une notification de la boutique : le propriétaire, et les membres ACTIFS qui ont le
 * droit de voir l'information (feature, mêmes réglages que les écrans). allSales : notifications de ventes, réservées
 * aux rôles qui voient TOUTES les ventes (le caissier et le magasinier ne voient que les leurs, décision du 26 oct.).
 * ownerOnly : propriétaire seulement. Un membre retiré n'y figure plus.
 */
export async function pushRecipients(admin: any, shopId: string, opts: { feature?: PermFeature; allSales?: boolean; ownerOnly?: boolean } = {}): Promise<Set<string>> {
  const ids = new Set<string>()
  const [{ data: shop }, { data: members }] = await Promise.all([
    admin.from('shops').select('owner_id, role_permissions').eq('id', shopId).maybeSingle(),
    admin.from('shop_members').select('user_id, role').eq('shop_id', shopId).eq('is_active', true),
  ])
  if (!shop) return ids
  if (shop.owner_id) ids.add(shop.owner_id)
  const stored = (shop.role_permissions as StoredPermissions | null) ?? null
  for (const m of (members || []) as { user_id: string; role: string | null }[]) {
    if (!m.user_id || !m.role) continue
    if (m.role === 'owner') { ids.add(m.user_id); continue }
    if (opts.ownerOnly) continue
    if (opts.allSales && (m.role === 'cashier' || m.role === 'stock_manager')) continue
    if (opts.feature && !resolvePermission(stored, m.role, opts.feature).view) continue
    ids.add(m.user_id)
  }
  return ids
}

/** Abonnements dont la personne figure parmi les destinataires autorisés */
export function onlyAllowed<T extends { user_id?: string | null }>(subs: T[] | null | undefined, allowed: Set<string>): T[] {
  return (subs || []).filter(s => !!s.user_id && allowed.has(s.user_id))
}
