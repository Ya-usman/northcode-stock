// Changements de formule sans perte (tarification, étape 4A-1, migration 212) : règle unique lib/saas/plan-change,
// écritures lib/saas/plan-change-server (base FACTICE en mémoire, aucune écriture réelle) et branchements.
// Usage : npx tsx tests/e2e/plan-change-pure.ts
import { readFileSync } from 'fs'
import { classifyChange, periodFor, unusedCredit, effectivePlan, pendingChange, isDowngrade, isActivePaid, CLEAR_NEXT } from '../../lib/saas/plan-change'
import { applyPlanPayment, prepareChange } from '../../lib/saas/plan-change-server'
import { getPeriodDays } from '../../lib/saas/countries'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const NOW = new Date('2026-11-04T12:00:00Z')
const DAY = 86_400_000
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString()
const src = (p: string) => readFileSync(p, 'utf8')
const M = getPeriodDays('monthly') // 31 jours

// Base factice : une entreprise, ses boutiques, ses abonnements. update() sur entities modifie la ligne.
function fakeAdmin(entity: Record<string, any>, subs: any[] = [], shops = [{ id: 's1' }]) {
  const writes: { table: string; values: any }[] = []
  const from = (table: string) => {
    let op: 'select' | 'update' = 'select', values: any = null
    const b: any = {
      select: () => b, eq: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, not: () => b, lte: () => b, gt: () => b,
      update: (v: any) => { op = 'update'; values = v; return b },
      maybeSingle: () => b.then((r: any) => ({ ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data })),
      then: (res: any, rej?: any) => {
        let out: any = { data: null, error: null }
        if (op === 'update') { writes.push({ table, values }); if (table === 'entities') Object.assign(entity, values); out = { data: [], error: null } }
        else if (table === 'entities') out = { data: [entity], error: null }
        else if (table === 'subscriptions') out = { data: subs, error: null }
        else if (table === 'shops') out = { data: shops, error: null }
        else if (table === 'custom_quotes') out = { data: [{ id: 'q1', status: 'quoted', limit_shops: 5, limit_seats: 12 }], error: null }
        return Promise.resolve(out).then(res, rej)
      },
    }
    return b
  }
  return { admin: { from }, writes, entity }
}
const account = (e: Record<string, any>) => ({ entityId: 'e1', ownerId: 'u1', name: 'Test', ...e }) as any

async function main() {
  const proActive = { plan: 'pro', plan_expires_at: iso(15) }

  console.log('1. Manière d\'appliquer')
  check('essai ou abonnement terminé : tout de suite', classifyChange({ plan: 'trial', plan_expires_at: null }, 'pro', NOW) === 'now' && classifyChange({ plan: 'pro', plan_expires_at: iso(-1) }, 'starter', NOW) === 'now')
  check('même formule en cours : à la suite', classifyChange(proActive, 'pro', NOW) === 'stack')
  check('formule supérieure : tout de suite (montée)', classifyChange(proActive, 'business', NOW) === 'now')
  check('formule inférieure : à la fin de la période (descente)', classifyChange(proActive, 'starter', NOW) === 'next')
  check('abonnement en cours ; essai non', isActivePaid(proActive, NOW) && !isActivePaid({ plan: 'trial', plan_expires_at: iso(10) }, NOW))
  check('descente : Pro → Starter oui, Starter → Pro non', isDowngrade('pro', 'starter') && !isDowngrade('starter', 'pro') && !isDowngrade('pro', 'pro'))

  console.log('\n2. Période payée')
  const st = periodFor('stack', proActive, 30, NOW)
  check('à la suite : commence à la fin actuelle (J+15), finit J+45', st.start.toISOString() === iso(15) && st.end.toISOString() === iso(45))
  const nw = periodFor('now', proActive, 30, NOW)
  check('tout de suite : commence maintenant, finit J+30', nw.start.getTime() === NOW.getTime() && nw.end.toISOString() === iso(30))
  check('à la suite mais abonnement terminé : commence maintenant', periodFor('stack', { plan: 'pro', plan_expires_at: iso(-2) }, 30, NOW).start.getTime() === NOW.getTime())

  console.log('\n3. Crédit d\'une montée')
  const sub = { amount: 10000, starts_at: iso(-15), expires_at: iso(15) }
  check('10 000 F payés, moitié utilisée : crédit 5 000 F', unusedCredit(sub, 'XOF', NOW) === 5000, unusedCredit(sub, 'XOF', NOW))
  check('arrondi VERS LE BAS à l\'unité (F) : 10 000 sur 3 jours, 1 restant → 3 333', unusedCredit({ amount: 10000, starts_at: iso(-2), expires_at: iso(1) }, 'XOF', NOW) === 3333)
  check('euros : centimes gardés (10 € moitié → 5,00)', unusedCredit({ amount: 10, starts_at: iso(-15), expires_at: iso(15) }, 'EUR', NOW) === 5)
  check('abonnement terminé, sans dates ou à 0 : pas de crédit', unusedCredit({ amount: 10000, starts_at: iso(-30), expires_at: iso(-1) }, 'XOF', NOW) === 0 && unusedCredit(null, 'XOF', NOW) === 0 && unusedCredit({ amount: 0, starts_at: iso(-1), expires_at: iso(1) }, 'XOF', NOW) === 0)
  check('période pas encore commencée : jamais plus que payé', unusedCredit({ amount: 10000, starts_at: iso(5), expires_at: iso(35) }, 'XOF', NOW) === 10000)

  console.log('\n4. Changement programmé')
  const sched = { plan: 'pro', plan_expires_at: iso(-1), next_plan: 'starter', next_plan_from: iso(-1), next_plan_until: iso(29) }
  const eff = effectivePlan(sched, NOW)
  check('date passée : vue = formule suivante, nouvelle fin (avant même la bascule écrite)', eff.switched && eff.plan === 'starter' && eff.plan_expires_at === iso(29))
  const later = { ...sched, plan_expires_at: iso(5), next_plan_from: iso(5), next_plan_until: iso(35) }
  check('date à venir : rien ne change, changement « programmé »', !effectivePlan(later, NOW).switched && pendingChange(later, NOW)?.plan === 'starter')
  check('rien de programmé : aucun changement', pendingChange({}, NOW) === null && !effectivePlan({ plan: 'pro', plan_expires_at: iso(5) }, NOW).switched)
  check('effacement complet des colonnes next_*', Object.keys(CLEAR_NEXT).length === 6 && Object.values(CLEAR_NEXT).every(v => v === null))

  console.log('\n5. Paiement préparé (refus)')
  {
    const f = fakeAdmin({}, [{ amount: 10000, starts_at: iso(-15), expires_at: iso(15), gateway: 'notchpay' }])
    const p = await prepareChange(f.admin, account(proActive), 'business', 'monthly', 15000, 'XOF', NOW)
    check('montée Pro → Business : tout de suite, crédit 5 000 F', p.schedule === 'now' && p.credit === 5000 && p.blocked === null, p)
    const p2 = await prepareChange(f.admin, account(proActive), 'business', 'monthly', 4000, 'XOF', NOW)
    check('crédit ≥ prix : refus « choisir une durée plus longue »', p2.blocked === 'upgrade_choose_longer')
    const g = fakeAdmin({}, [{ amount: 10000, starts_at: iso(-15), expires_at: iso(15), gateway: 'wallet_credit' }])
    check('période payée avec le portefeuille : pas de crédit', (await prepareChange(g.admin, account(proActive), 'business', 'monthly', 15000, 'XOF', NOW)).credit === 0)
    const pend = account({ ...proActive, next_plan: 'starter', next_plan_from: iso(15), next_plan_until: iso(45) })
    check('descente déjà programmée : autre changement refusé', (await prepareChange(f.admin, pend, 'business', 'monthly', 15000, 'XOF', NOW)).blocked === 'plan_change_pending')
    check('descente déjà programmée : renouveler Pro refusé aussi', (await prepareChange(f.admin, pend, 'pro', 'monthly', 10000, 'XOF', NOW)).blocked === 'plan_change_pending')
    const same = account({ ...proActive, next_plan: 'pro', next_plan_from: iso(15), next_plan_until: iso(45) })
    check('renouvellement anticipé déjà payé (même formule) : renouveler encore permis', (await prepareChange(f.admin, same, 'pro', 'monthly', 10000, 'XOF', NOW)).blocked === null)
    const trial = await prepareChange(f.admin, account({ plan: 'trial', plan_expires_at: null }), 'pro', 'monthly', 10000, 'XOF', NOW)
    check('pendant l\'essai : tout de suite, sans crédit', trial.schedule === 'now' && trial.credit === 0 && trial.blocked === null)
  }

  console.log('\n6. Paiement confirmé (base factice)')
  {
    const e = { plan: 'pro', plan_expires_at: iso(15), addon_seats: 1, addon_shops: 0 }
    const f = fakeAdmin(e)
    const r = await applyPlanPayment(f.admin, account(e), { plan: 'starter', period: 'monthly', schedule: 'next', addonSeats: 0, addonShops: 0, kind: 'plan', reference: 'SS-1' }, NOW)
    check('descente : formule INCHANGÉE jusqu\'à la fin', e.plan === 'pro' && e.plan_expires_at === iso(15))
    check('descente : Starter programmé de J+15 à J+15+1 mois', (e as any).next_plan === 'starter' && (e as any).next_plan_from === iso(15) && (e as any).next_plan_until === iso(15 + M) && r.end.toISOString() === iso(15 + M))
  }
  {
    const e = { plan: 'pro', plan_expires_at: iso(15), addon_seats: 1, addon_shops: 0, addon_seats_renew: null, addon_shops_renew: null }
    const f = fakeAdmin(e)
    await applyPlanPayment(f.admin, account(e), { plan: 'pro', period: 'monthly', schedule: 'stack', addonSeats: 1, addonShops: 0, kind: 'plan', reference: 'SS-2' }, NOW)
    check('renouvellement anticipé, mêmes options : fin J+15+1 mois, rien de programmé', e.plan_expires_at === iso(15 + M) && !(e as any).next_plan)
  }
  {
    const e: any = { plan: 'pro', plan_expires_at: iso(15), addon_seats: 1, addon_shops: 0 }
    const f = fakeAdmin(e)
    await applyPlanPayment(f.admin, account(e), { plan: 'pro', period: 'monthly', schedule: 'stack', addonSeats: 3, addonShops: 1, kind: 'plan', reference: 'SS-3' }, NOW)
    check('renouvellement anticipé, autres options : options d\'aujourd\'hui gardées jusqu\'à J+15', e.addon_seats === 1 && e.addon_shops === 0)
    check('… options nouvelles programmées à partir de J+15', e.next_plan === 'pro' && e.next_plan_from === iso(15) && e.next_plan_until === iso(15 + M) && e.next_addon_seats === 3)
  }
  {
    // Deux renouvellements anticipés de suite, mêmes options la seconde fois : la bascule ne doit PAS ramener la fin à J+15+1 mois
    const e: any = { plan: 'pro', plan_expires_at: iso(15 + M), addon_seats: 1, addon_shops: 0, next_plan: 'pro', next_plan_from: iso(15), next_plan_until: iso(15 + M), next_addon_seats: 1, next_addon_shops: 0 }
    const f = fakeAdmin(e)
    await applyPlanPayment(f.admin, account(e), { plan: 'pro', period: 'monthly', schedule: 'stack', addonSeats: 1, addonShops: 0, kind: 'plan', reference: 'SS-4' }, NOW)
    check('2e renouvellement anticipé : fin J+15+2 mois et changement programmé prolongé à J+15+2 mois (jours gardés)', e.plan_expires_at === iso(15 + 2 * M) && e.next_plan_until === iso(15 + 2 * M) && e.next_plan_from === iso(15))
    check('… après la bascule : fin J+15+2 mois', effectivePlan(e, new Date(NOW.getTime() + 16 * DAY)).plan_expires_at === iso(15 + 2 * M))
  }
  {
    const e: any = { plan: 'pro', plan_expires_at: iso(15), addon_seats: 1, addon_shops: 0, next_plan: 'pro', next_plan_from: iso(15), next_plan_until: iso(15 + M) }
    const f = fakeAdmin(e)
    await applyPlanPayment(f.admin, account(e), { plan: 'business', period: 'monthly', schedule: 'now', addonSeats: 2, addonShops: 1, kind: 'plan', reference: 'SS-5' }, NOW)
    check('montée : Business tout de suite jusqu\'à 1 mois, essai effacé', e.plan === 'business' && e.plan_expires_at === iso(M) && e.trial_ends_at === null)
    check('… changement programmé remplacé, options du paiement appliquées', e.next_plan === null && e.addon_seats === 2 && e.addon_shops === 1)
  }

  console.log('\n7. Branchements (sources)')
  const subscribe = src('app/api/billing/subscribe/route.ts')
  check('paiement préparé : refus 409 si changement bloqué', subscribe.includes('prepareChange(') && subscribe.includes('change.blocked'))
  check('paiement préparé : crédit déduit et enregistré avec la manière d\'appliquer', subscribe.includes('schedule: change.schedule') && subscribe.includes('prorata_credit: change.credit'))
  const pi = src('lib/billing/payment-intents.ts')
  check('confirmation : situation d\'avant gardée (remboursement d\'erreur)', pi.includes('prev_plan') && pi.includes('prev_plan_expires_at') && pi.includes('prev_trial_ends_at'))
  check('confirmation : application par la règle unique applyPlanPayment', pi.includes('applyPlanPayment('))
  const rc = src('app/api/cron/renewal-check/route.ts')
  check('renouvellement auto : période suivante déjà payée → rien prélevé', rc.includes('pendingChange(account, now)') && rc.includes('alreadyPaid++'))
  check('renouvellement auto : offre sur mesure jamais prélevée au prix normal', rc.includes('getEntityCustom('))
  const gr = src('app/api/cron/grant-reminders/route.ts')
  check('tâche du matin : bascules dues + rappel 7 jours avant une descente', gr.includes('applyScheduledPlan(') && gr.includes("'billing.plan_change_reminder'") && gr.includes('isDowngrade('))
  const ent = src('lib/saas/entity.ts')
  check('lecture de l\'abonnement : bascule à la date même sans la tâche du matin', ent.includes('effectivePlan(') && ent.includes('applyScheduledPlan('))
  check('bascule tracée ; la tâche du matin remet les limites en ordre pour toutes les bascules (lecture comprise)', ent.includes("action: 'billing.plan_switch'") && gr.includes(".eq('action', 'billing.plan_switch')") && gr.includes('enforceShopPlanLimits('))
  check('entity.ts ne charge rien de réservé au serveur (lu aussi par des pages du navigateur)', !/(from|import\()\s*'[^']*(enforce-limits|lib\/api\/audit|supabase\/server)'/.test(ent))
  const refund = src('app/api/admin/payments/refund/route.ts')
  check('remboursement : super_admin, motif obligatoire, 48 h', refund.includes("tier: 'super_admin'") && refund.includes('reason.length < 3') && refund.includes('hours > 48'))
  check('remboursement : une seule fois (écriture conditionnée au statut payé)', refund.includes(".eq('status', 'paid').select('id')"))
  check('remboursement : refusé si un paiement de formule plus récent existe (il serait effacé)', refund.includes(".gt('settled_at', pi.settled_at)") && refund.includes("remboursez d'abord"))
  check('remboursement : situation d\'avant remise + changement programmé retiré + journal', refund.includes('pi.prev_plan') && refund.includes('...CLEAR_NEXT') && refund.includes("'admin.payment_refund'"))
  const page = src('app/[locale]/(app)/billing/page.tsx')
  check('page Abonnement : aperçu crédit / à la suite / à la fin / refus', ['checkout-prorata', 'checkout-schedule', 'checkout-blocked', 'billing-pending-change'].every(id => page.includes(id)))
  const mig = src('supabase/migrations/212_plan_changes.sql')
  check('212 : abonnements de 6 mois acceptés', mig.includes("'semiannual'"))

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
}
main()
