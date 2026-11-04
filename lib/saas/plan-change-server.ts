// Changements de formule — écritures SERVEUR (client admin). Règles : lib/saas/plan-change (migration 212).

import { getPeriodDays, type BillingPeriod } from './countries'
import { setAccountPlan, type EntityAccount } from './entity'
import { applyRenewalAddons, getEntityAddons } from './addons'
import { applyCustomPlan, clearCustomPlan } from './custom-plan-server'
import { CLEAR_NEXT, classifyChange, isActivePaid, pendingChange, periodFor, unusedCredit, type Schedule } from './plan-change'

export interface PlanPayment {
  plan: 'starter' | 'pro' | 'business'
  period: BillingPeriod
  schedule: Schedule
  addonSeats: number
  addonShops: number
  kind: 'plan' | 'custom'
  quoteId?: string | null
  reference: string
}

/**
 * Applique un paiement de formule confirmé à l'entreprise, selon la manière décidée au paiement préparé :
 *   • now   : formule et nouvelle période tout de suite (options du paiement, offre sur mesure selon le type) ;
 *   • stack : même formule, période ajoutée à la fin de l'actuelle ; options du paiement à partir de cette fin ;
 *   • next  : formule inférieure à la fin de la période payée (changement programmé), rien ne change avant.
 * Renvoie la période payée (début, fin) pour l'abonnement enregistré.
 */
export async function applyPlanPayment(admin: any, account: EntityAccount, p: PlanPayment, now = new Date()): Promise<{ start: Date; end: Date }> {
  const days = getPeriodDays(p.period)
  const current = { plan: account.plan, plan_expires_at: account.plan_expires_at }
  const { start, end } = periodFor(p.schedule, current, days, now)

  if (p.schedule === 'next') {
    await admin.from('entities').update({
      next_plan: p.plan, next_plan_from: start.toISOString(), next_plan_until: end.toISOString(), next_billing_period: p.period,
      next_addon_seats: p.addonSeats, next_addon_shops: p.addonShops, updated_at: now.toISOString(),
    }).eq('id', account.entityId)
    return { start, end }
  }

  const { error } = await setAccountPlan(admin, account, { plan: p.plan, plan_expires_at: end.toISOString(), trial_ends_at: null })
  if (error) { console.error('[plan-change] formule non enregistrée', account.entityId, error); return { start, end } }

  if (p.schedule === 'stack') {
    // Options de la période ajoutée : à partir de la fin de l'actuelle (changement programmé sur la même formule) si
    // elles diffèrent de celles en cours ; sinon rien à programmer. Un changement déjà programmé (renouvellement
    // anticipé précédent, même formule : seul cas permis par prepareChange) est PROLONGÉ jusqu'à la nouvelle fin, sans
    // quoi la bascule ramènerait la fin de période à la sienne et les jours de ce paiement seraient perdus.
    const cur = await getEntityAddons(admin, account.entityId)
    const pend = pendingChange(account, now)
    if (p.kind === 'custom' && p.quoteId) await applyCustomPlan(admin, account.entityId, p.quoteId, p.reference, now)
    else if (pend || cur.seats !== p.addonSeats || cur.shops !== p.addonShops) {
      await admin.from('entities').update({
        next_plan: p.plan, next_plan_from: pend ? pend.from : start.toISOString(), next_plan_until: end.toISOString(), next_billing_period: p.period,
        next_addon_seats: p.addonSeats, next_addon_shops: p.addonShops,
      }).eq('id', account.entityId)
    } else await admin.from('entities').update({ addon_seats_renew: null, addon_shops_renew: null }).eq('id', account.entityId)
    return { start, end }
  }

  // now : tout de suite ; un changement programmé éventuel est remplacé
  await admin.from('entities').update(CLEAR_NEXT).eq('id', account.entityId)
  if (p.kind === 'custom' && p.quoteId) await applyCustomPlan(admin, account.entityId, p.quoteId, p.reference, now)
  else {
    await applyRenewalAddons(admin, account.entityId, p.addonSeats, p.addonShops)
    await clearCustomPlan(admin, account.entityId)
  }
  return { start, end }
}

/** Dernier abonnement payé de l'entreprise (pour le crédit d'une montée) */
export async function lastPaidSubscription(admin: any, shopIds: string[]): Promise<{ amount: number; starts_at: string; expires_at: string } | null> {
  if (!shopIds.length) return null
  const { data } = await admin.from('subscriptions').select('amount, starts_at, expires_at, gateway')
    .in('shop_id', shopIds).eq('status', 'active').order('expires_at', { ascending: false }).limit(1)
  const s = data?.[0]
  return s && s.gateway !== 'wallet_credit' ? { amount: Number(s.amount), starts_at: s.starts_at, expires_at: s.expires_at } : null
}

export interface PreparedChange {
  schedule: Schedule
  credit: number
  start: Date
  end: Date
  /** Refus : changement déjà programmé, ou crédit supérieur au prix (choisir une durée plus longue) */
  blocked: 'plan_change_pending' | 'upgrade_choose_longer' | null
  pending: { plan: string; from: string } | null
}

/**
 * Paiement de la formule `target` pour `period` au montant `amount` (formule + options, devise de facturation) :
 * manière d'appliquer, crédit d'une montée (jours payés non utilisés), période, refus éventuel. Même calcul pour
 * l'aperçu de la page Abonnement et pour le paiement préparé.
 */
export async function prepareChange(admin: any, account: EntityAccount | null, target: string, period: BillingPeriod, amount: number, currency: string, now = new Date()): Promise<PreparedChange> {
  const current = { plan: account?.plan, plan_expires_at: account?.plan_expires_at }
  const pending = account ? pendingChange(account, now) : null
  const schedule = classifyChange(current, target, now)
  const { start, end } = periodFor(schedule, current, getPeriodDays(period), now)
  let credit = 0
  if (account && schedule === 'now' && isActivePaid(current, now)) {
    const shopIds = await getEntityShopIdsAll(admin, account.entityId)
    credit = unusedCredit(await lastPaidSubscription(admin, shopIds), currency, now)
  }
  // Un changement déjà programmé (descente, ou options de la période suivante) : on ne superpose pas un autre
  // changement de formule ; un renouvellement de la même formule reste possible
  // (seul cas permis : options de la période suivante programmées sur la même formule, et on renouvelle cette formule)
  const blocked = pending && (pending.plan !== target || current.plan !== target) ? 'plan_change_pending' : credit > 0 && credit >= amount ? 'upgrade_choose_longer' : null
  return { schedule, credit, start, end, blocked, pending }
}

async function getEntityShopIdsAll(admin: any, entityId: string): Promise<string[]> {
  const { data } = await admin.from('shops').select('id').eq('entity_id', entityId).is('deleted_at', null)
  return (data || []).map((s: any) => s.id)
}
