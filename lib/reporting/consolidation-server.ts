// Chargement du contexte de consolidation multi-devises — SERVEUR UNIQUEMENT (client admin).
// Le calcul lui-même est pur : lib/reporting/consolidation.ts.
//
// La devise de consolidation appartient à l'ENTREPRISE : elle est relue en base à chaque requête
// (boutique → shops.entity_id → entities.consolidation_currency). Aucune route ne l'accepte du navigateur,
// aucun état n'est conservé entre deux requêtes.

import { PIVOT_CURRENCY } from '@/lib/saas/exchange'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { buildRateIndex, needsConsolidation, MAX_FALLBACK_DAYS, type ConsolidationScope, type RateRow } from './consolidation'

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export interface LoadedScope extends ConsolidationScope {
  /** Devise opérationnelle de chaque boutique du périmètre (shops.currency). */
  shopCurrency: Record<string, string>
  /** Entreprise unique du périmètre, sinon null (plusieurs entreprises, ou boutique sans entreprise). */
  entityId: string | null
}

/**
 * `shopIds` = boutiques RÉELLEMENT autorisées du périmètre (déjà filtrées par le contrôle d'accès de la route).
 * Renvoie la devise de chaque boutique, la devise de consolidation de LEUR entreprise et les taux nécessaires
 * sur [from, to] (YYYY-MM-DD). Les taux ne sont chargés que si une consolidation s'applique (plusieurs devises,
 * une seule entreprise). Boutiques de plusieurs entreprises : multipleEntities, target null, aucun consolidé.
 * Lecture paginée : aucune troncature silencieuse à 1000 lignes.
 */
export async function loadConsolidationScope(admin: any, shopIds: string[], range: { from: string; to: string }): Promise<LoadedScope> {
  const { data: shops, error } = shopIds.length
    ? await admin.from('shops').select('id, currency, entity_id').in('id', shopIds)
    : { data: [], error: null }
  if (error) throw new Error(error.message)
  const shopCurrency: Record<string, string> = {}
  for (const s of shops || []) shopCurrency[s.id] = s.currency
  const scopeCurrencies: string[] = Array.from(new Set<string>((shops || []).map((s: any) => s.currency as string))).sort()
  // Une boutique sans entreprise compte comme une entreprise distincte : jamais rattachée par défaut à une autre.
  const entityKeys: string[] = Array.from(new Set<string>((shops || []).map((s: any) => (s.entity_id as string) || `none:${s.id}`)))
  const entityId = entityKeys.length === 1 && !entityKeys[0].startsWith('none:') ? entityKeys[0] : null
  const multipleEntities = entityKeys.length > 1

  let target: string | null = null
  if (entityId) {
    const { data: ent, error: e2 } = await admin.from('entities').select('consolidation_currency').eq('id', entityId).single()
    if (e2) throw new Error(e2.message)
    target = ent?.consolidation_currency ?? null
  }

  let rows: RateRow[] = []
  if (needsConsolidation({ target, scopeCurrencies, multipleEntities })) {
    // Jambes de marché nécessaires : devises du périmètre + cible ; XAF / XOF passent par l'euro (parité fixe).
    const legs = new Set<string>()
    for (const c of [...scopeCurrencies, target!]) legs.add(c === 'XAF' || c === 'XOF' ? 'EUR' : c)
    legs.delete(PIVOT_CURRENCY)
    if (legs.size) {
      const raw = await fetchAllRows<any>(() => admin
        .from('exchange_rates')
        .select('id, base_currency, effective_date, rate, provider, is_manual_override')
        .eq('quote_currency', PIVOT_CURRENCY)
        .in('base_currency', Array.from(legs))
        .gte('effective_date', shiftDay(range.from, -MAX_FALLBACK_DAYS))
        .lte('effective_date', range.to)
        .order('effective_date', { ascending: true })
        .order('id', { ascending: true }))
      rows = raw.map((r: any) => ({
        currency: r.base_currency, effective_date: r.effective_date, rate: Number(r.rate),
        provider: r.provider, is_manual_override: !!r.is_manual_override,
      }))
    }
  }
  return { target, scopeCurrencies, multipleEntities, index: buildRateIndex(rows), shopCurrency, entityId }
}
