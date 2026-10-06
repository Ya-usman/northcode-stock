import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/api/require-admin'
import {
  COHORT_WEEKS, DAY, accountsToHelp, cohorts, funnelSummary, nudgeStats, tourStats, weekStart,
  type ActivationAccount, type NudgeRow,
} from '@/lib/admin/activation'

// GET /api/admin/activation — Admin → Activation (onboarding lot C2). LECTURE
// SEULE, tout administrateur (support compris). Comptes = propriétaires dont la
// plus ancienne boutique a moins de 8 semaines ; comptes internes et adresses
// de test écartés. Toute lecture en erreur arrête le calcul (pas de chiffres
// faux en silence).

/** Domaines réservés aux exemples et aux tests (RFC 2606 / 6761) — même règle que les relances */
const isReservedAddress = (email: string) =>
  /@(?:[^@]+\.)?(example\.(com|net|org)|[^@]+\.(test|example|invalid|localhost))$/i.test(email) || /@localhost$/i.test(email)

export async function GET() {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  try {
    const admin = await createAdminClient() as any
    const must = <T,>(r: { data?: T; count?: number | null; error: any }) => { if (r.error) throw new Error(r.error.message); return r }
    const now = Date.now()
    const since = weekStart(now) - (COHORT_WEEKS - 1) * 7 * DAY

    // ── Boutiques, entreprises, propriétaires ───────────────────────────────
    const shops = must(await admin.from('shops')
      .select('id, name, created_at, is_internal, entity_id, deleted_at, phone, whatsapp, logo_url, receipt_tagline, receipt_footer, receipt_legal_ids')
      .is('deleted_at', null)).data as any[]
    const entities = must(await admin.from('entities').select('id, is_internal')).data as any[]
    const internalEntity = new Set(entities.filter(e => e.is_internal).map(e => e.id))
    const members = must(await admin.from('shop_members').select('shop_id, user_id, role, is_active')).data as any[]
    const shopById = new Map(shops.map(s => [s.id, s]))

    const ownedBy = new Map<string, any[]>()
    for (const m of members) {
      if (m.role !== 'owner' || !shopById.has(m.shop_id)) continue
      ownedBy.set(m.user_id, [...(ownedBy.get(m.user_id) ?? []), shopById.get(m.shop_id)])
    }

    // Adresses e-mail (une seule lecture paginée)
    const emails = new Map<string, string>()
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(error.message)
      for (const u of data.users) if (u.email) emails.set(u.id, u.email)
      if (data.users.length < 1000) break
    }
    const adminIds = new Set((must(await admin.from('admin_users').select('user_id').is('revoked_at', null)).data as any[]).map(a => a.user_id))

    // Comptes de la période (plus ancienne boutique dans les 8 semaines)
    const candidates = Array.from(ownedBy.entries()).map(([ownerId, owned]: [string, any[]]) => {
      const oldest = [...owned].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0]
      return { ownerId, owned, oldest, createdAt: new Date(oldest.created_at).getTime() }
    }).filter(c => c.createdAt >= since
      && !adminIds.has(c.ownerId)
      && !c.owned.some(s => s.is_internal || internalEntity.has(s.entity_id))
      && !isReservedAddress(emails.get(c.ownerId) ?? ''))

    const profiles = candidates.length
      ? must(await admin.from('profiles').select('id, full_name').in('id', candidates.map(c => c.ownerId))).data as any[] : []
    const nameOf = new Map(profiles.map(p => [p.id, p.full_name]))

    // ── Premier produit / première vente / catégories par boutique ─────────
    const firstAndCount = async (table: string, shopIds: string[]) => {
      const [first, count] = await Promise.all([
        admin.from(table).select('created_at').in('shop_id', shopIds).order('created_at', { ascending: true }).limit(1),
        admin.from(table).select('id', { count: 'exact', head: true }).in('shop_id', shopIds),
      ])
      must(first); must(count)
      return { first: first.data?.[0] ? new Date(first.data[0].created_at).getTime() : null, count: count.count ?? 0 }
    }
    const accounts: ActivationAccount[] = await Promise.all(candidates.map(async c => {
      const ids = c.owned.map(s => s.id)
      const [products, sales, categories] = await Promise.all([firstAndCount('products', ids), firstAndCount('sales', ids), firstAndCount('categories', ids)])
      return {
        ownerId: c.ownerId,
        ownerName: nameOf.get(c.ownerId) ?? null,
        email: emails.get(c.ownerId) ?? null,
        phone: c.owned.map(s => s.whatsapp || s.phone).find(Boolean) ?? null,
        shopId: c.oldest.id,
        shopName: c.oldest.name,
        shopCount: c.owned.length,
        createdAt: c.createdAt,
        firstProductAt: products.first,
        firstSaleAt: sales.first,
        products: products.count,
        sales: sales.count,
        hasCategory: categories.count > 0,
        hasMember: members.some(m => ids.includes(m.shop_id) && m.role !== 'owner' && m.is_active),
        hasReceipt: c.owned.some(s => s.logo_url || s.receipt_tagline || s.receipt_footer || s.receipt_legal_ids),
      }
    }))
    // Derniers messages du support (migration 167 ; table pas encore créée → aucun)
    if (accounts.length) {
      const sc = await admin.from('support_contacts').select('user_id, channel, created_at, sent_by').in('user_id', accounts.map(a => a.ownerId)).order('created_at', { ascending: false })
      if (sc.error && !/support_contacts|does not exist|PGRST205/i.test(sc.error.message)) throw new Error(sc.error.message)
      const rows = (sc.data || []) as any[]
      const senderIds = Array.from(new Set(rows.map(r => r.sent_by).filter(Boolean))) as string[]
      const senders = senderIds.length ? must(await admin.from('profiles').select('id, full_name').in('id', senderIds)).data as any[] : []
      const senderName = new Map(senders.map(p => [p.id, p.full_name]))
      for (const a of accounts) {
        const r = rows.find(x => x.user_id === a.ownerId)
        a.lastContact = r ? { at: r.created_at, channel: r.channel, by: senderName.get(r.sent_by) ?? null } : null
      }
    }
    const byOwner = new Map(accounts.map(a => [a.ownerId, a]))

    // ── Tours guidés (personnes de la plateforme, administrateurs et adresses de test exclus) ──
    const onboarding = (must(await admin.from('user_onboarding').select('user_id, tours, nudges_unsubscribed_at')).data as any[])
      .filter(r => !adminIds.has(r.user_id) && !isReservedAddress(emails.get(r.user_id) ?? ''))
    // ── Relances e-mail ─────────────────────────────────────────────────────
    const nudges = must(await admin.from('onboarding_nudges').select('user_id, nudge, variant, sent_at')).data as NudgeRow[]

    return NextResponse.json({
      generatedAt: new Date(now).toISOString(),
      summary: funnelSummary(accounts),
      cohorts: cohorts(accounts, now),
      tours: tourStats(onboarding),
      nudges: nudgeStats(nudges, byOwner),
      unsubscribed: onboarding.filter(r => r.nudges_unsubscribed_at).length,
      toHelp: accountsToHelp(accounts, now),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
