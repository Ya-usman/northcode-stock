// Données du bilan du matin (serveur, client admin). Lecture seule.
// Montants convertis dans la devise de reporting (XAF) avec les derniers
// taux connus ; une devise sans taux est signalée, jamais inventée.

import { getExchangeRates } from '@/lib/saas/exchange-service'
import { convertByCurrency } from '@/lib/saas/exchange'
import { resolveCurrencyCode } from '@/lib/saas/currencies'
import { getCountry, getBillingCurrency } from '@/lib/saas/countries'
import { getPlan } from '@/lib/saas/plans'
import { CRON_JOBS } from '@/lib/cron/jobs'
import type { MorningReport, JobState } from '@/lib/email/morning-check-template'

export const REPORTING_CURRENCY = 'XAF'
const H = 3600_000, D = 24 * H

export async function collectMorningReport(admin: any, now = new Date()): Promise<Omit<MorningReport, 'services' | 'date' | 'time' | 'appUrl' | 'env' | 'contactEmail'>> {
  const t = now.getTime()
  const iso = (ms: number) => new Date(ms).toISOString()

  const [
    { data: shops }, { count: totalUsers }, { count: newUsers }, { data: newEntities },
    { data: sales7 }, { count: unpaidSales }, { data: subs24 }, { data: entities }, { data: runs },
  ] = await Promise.all([
    admin.from('shops').select('id, name, currency, country, billing_country, is_internal, created_at, entity_id').is('deleted_at', null),
    admin.from('profiles').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', iso(t - D)),
    admin.from('entities').select('id, name, is_internal').gte('created_at', iso(t - D)),
    admin.from('sales').select('shop_id, total, created_at').eq('sale_status', 'active').gte('created_at', iso(t - 7 * D)),
    admin.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', iso(t - D)).eq('payment_status', 'unpaid').eq('payment_method', 'cash'),
    admin.from('subscriptions').select('id, shop_id, entity_id, amount, created_at').gte('created_at', iso(t - D)),
    admin.from('entities').select('id, name, plan, trial_ends_at, plan_expires_at, is_internal'),
    admin.from('cron_runs').select('job_name, status, summary, error, created_at').gte('created_at', iso(t - 26 * H)).order('created_at', { ascending: false }),
  ])

  const shopList = shops || []
  const shopById = new Map(shopList.map((s: any) => [s.id, s]))
  const internal = new Set(shopList.filter((s: any) => s.is_internal).map((s: any) => s.id))
  const realShops = shopList.filter((s: any) => !s.is_internal)

  // ── Ventes : 24 h, 24 h précédentes, moyenne 7 j — par devise puis convertis ──
  const { rates } = await getExchangeRates(admin)
  const bucket = () => ({} as Record<string, number>)
  const last = bucket(), prev = bucket(), week = bucket()
  let salesCount24 = 0
  const shops24 = new Set<string>(), shops7 = new Set<string>()
  for (const s of sales7 || []) {
    if (internal.has(s.shop_id)) continue
    const shop: any = shopById.get(s.shop_id)
    const cur = resolveCurrencyCode(shop?.currency, shop?.country) || 'XOF'
    const at = new Date(s.created_at).getTime(), amt = Number(s.total) || 0
    week[cur] = (week[cur] || 0) + amt
    shops7.add(s.shop_id)
    if (at >= t - D) { last[cur] = (last[cur] || 0) + amt; salesCount24++; shops24.add(s.shop_id) }
    else if (at >= t - 2 * D) prev[cur] = (prev[cur] || 0) + amt
  }
  const conv = (b: Record<string, number>) => convertByCurrency(b, REPORTING_CURRENCY, rates)
  const cLast = conv(last), cPrev = conv(prev), cWeek = conv(week)
  const missing = Array.from(new Set([...cLast.missing, ...cPrev.missing, ...cWeek.missing]))

  // ── Abonnements (revenu StockShop) ──
  const paid24 = (subs24 || []).filter((s: any) => Number(s.amount) > 0)
  const subAmounts = bucket()
  for (const s of paid24) {
    const shop: any = shopById.get(s.shop_id)
    const cur = getBillingCurrency(getCountry(shop?.billing_country || shop?.country))
    subAmounts[cur] = (subAmounts[cur] || 0) + Number(s.amount)
  }
  // Premier paiement d'une entreprise = passage de l'essai à l'abonnement payant
  let newPaid = 0
  const ents24 = Array.from(new Set(paid24.map((s: any) => s.entity_id).filter(Boolean))) as string[]
  if (ents24.length) {
    const { data: earlier } = await admin.from('subscriptions').select('entity_id').in('entity_id', ents24).lt('created_at', iso(t - D)).gt('amount', 0)
    const had = new Set((earlier || []).map((e: any) => e.entity_id))
    newPaid = ents24.filter(e => !had.has(e)).length
  }
  const ents = (entities || []).filter((e: any) => !e.is_internal)
  const trialsActive = ents.filter((e: any) => e.plan === 'trial' && e.trial_ends_at && new Date(e.trial_ends_at).getTime() > t)
  const trialsEnding = trialsActive
    .filter((e: any) => new Date(e.trial_ends_at).getTime() <= t + 3 * D)
    .sort((a: any, b: any) => a.trial_ends_at.localeCompare(b.trial_ends_at))
    .map((e: any) => ({ name: e.name || 'Entreprise sans nom', ends_at: e.trial_ends_at }))
  const plansEnding = ents
    .filter((e: any) => e.plan !== 'trial' && e.plan_expires_at && new Date(e.plan_expires_at).getTime() > t && new Date(e.plan_expires_at).getTime() <= t + 7 * D)
    .sort((a: any, b: any) => a.plan_expires_at.localeCompare(b.plan_expires_at))
    .map((e: any) => ({ name: e.name || 'Entreprise sans nom', plan: getPlan(e.plan).name, expires_at: e.plan_expires_at }))

  // ── Clients à surveiller : boutiques de plus de 7 jours sans aucune vente sur 7 jours ──
  const silent = realShops
    .filter((s: any) => new Date(s.created_at).getTime() < t - 7 * D && !shops7.has(s.id))
    .map((s: any) => s.name as string)
    .sort((a: string, b: string) => a.localeCompare(b, 'fr'))

  // ── Tâches automatiques : dernière exécution de chacune sur 26 h ──
  const lastRun = new Map<string, any>()
  for (const r of runs || []) if (!lastRun.has(r.job_name)) lastRun.set(r.job_name, r)
  const jobs: JobState[] = CRON_JOBS.filter(j => j.name !== 'morning-check').map(j => {
    const r = lastRun.get(j.name)
    if (!r) return { label: j.label, status: 'missing' }
    if (r.status === 'error') return { label: j.label, status: 'error', at: r.created_at, error: String(r.error || '').slice(0, 160) }
    if (r.summary?.paused) return { label: j.label, status: 'paused', at: r.created_at }
    return { label: j.label, status: 'ok', at: r.created_at }
  })

  return {
    metrics: {
      newShops: realShops.filter((s: any) => new Date(s.created_at).getTime() >= t - D).length,
      activeSaleShops: shops24.size,
      totalSales: salesCount24,
      unpaidSales: unpaidSales ?? 0,
      totalShops: realShops.length,
      totalUsers: totalUsers ?? 0,
      newUsers: newUsers ?? 0,
      newEntities: (newEntities || []).filter((e: any) => !e.is_internal).length,
    },
    revenue: {
      currency: REPORTING_CURRENCY,
      last24: cLast.value,
      prev24: cPrev.value,
      avg7: cWeek.value / 7,
      missing,
    },
    billing: {
      payments24: paid24.length,
      amount24: convertByCurrency(subAmounts, REPORTING_CURRENCY, rates).value,
      newPaid24: newPaid,
      trialsActive: trialsActive.length,
      trialsEnding,
    },
    expiringPlans: plansEnding,
    silentShops: silent,
    jobs,
  }
}
