// Pays de tarification (règles validées le 3 nov. 2026, migration 208) — RÈGLE UNIQUE, serveur.
//
// Le prix suit le pays où la boutique FONCTIONNE :
//   1. pays fixé par l'administration (entities.pricing_country, motif obligatoire) : il l'emporte toujours ;
//   2. sinon, l'activité OPÉRATIONNELLE des 30 derniers jours (ventes, entrées de stock, inventaires de tous les
//      membres) : si au moins 70 % de cette activité se fait dans un pays de ZONE PLUS CHÈRE que le pays déclaré, avec
//      au moins 20 opérations, c'est ce pays qui fixe le prix ;
//   3. sinon, le pays déclaré à l'inscription (entities.billing_country, non modifiable par le client).
// Jamais l'inverse : une activité dans un pays moins cher ne baisse pas le prix (elle se règle avec l'administration).
// Un propriétaire qui voyage ne pèse presque rien (les connexions ne comptent pas comme opérations) ; payer avec une
// carte étrangère ne change rien (diaspora). Seul le code pays fourni par l'hébergeur est lu, jamais l'adresse IP, et
// jamais un en-tête envoyé par l'appareil (x-user-country est ignoré ici).

import { COUNTRIES } from './countries'

/** Zones de prix : 1 revenus modestes, 2 pays émergents, 3 revenus élevés (tableau du 3 nov. 2026) */
const ZONE_3 = new Set(['US', 'CA', 'GB', 'CH', 'JP', 'KR', 'SG', 'AE', 'SA',
  'DE', 'AT', 'BE', 'BG', 'HR', 'CY', 'DK', 'ES', 'EE', 'FI', 'FR', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'CZ', 'RO', 'SK', 'SI', 'SE'])
const ZONE_2 = new Set(['CN', 'MY', 'TH', 'BR', 'MX', 'CL', 'CO', 'PE', 'AR', 'UY', 'EC', 'PA', 'CR'])
/** Pays inconnus de l'application : traités comme la zone la plus chère (jamais un rabais par défaut) */
export function priceZone(country: string | null | undefined): 1 | 2 | 3 {
  const c = String(country || '').toUpperCase()
  if (!(c in COUNTRIES)) return 3
  return ZONE_3.has(c) ? 3 : ZONE_2.has(c) ? 2 : 1
}

export const ACTIVITY_WINDOW_DAYS = 30
export const ACTIVITY_MIN_OPS = 20
export const ACTIVITY_MAJORITY = 0.7

export interface ActivityRow { country: string; ops: number }
export interface PricingCountry {
  /** Pays dont le tarif s'applique */
  country: string
  reason: 'declared' | 'activity' | 'override'
  declared: string
  /** Pays majoritaire de l'activité (et sa part), s'il y a assez d'opérations */
  activityCountry: string | null
  activityShare: number
  activityOps: number
}

/** Pays majoritaire de l'activité : part des opérations, sur les lignes fournies (déjà limitées à la fenêtre) */
export function activityMajority(rows: ActivityRow[]): { country: string | null; share: number; total: number } {
  const by = new Map<string, number>()
  for (const r of rows) by.set(r.country, (by.get(r.country) || 0) + Math.max(0, Number(r.ops) || 0))
  const total = Array.from(by.values()).reduce((a, b) => a + b, 0)
  if (!total) return { country: null, share: 0, total: 0 }
  const [country, ops] = Array.from(by.entries()).sort((a, b) => b[1] - a[1])[0]
  return { country, share: ops / total, total }
}

export function resolvePricingCountry(input: { declared: string | null | undefined; override?: string | null; activity: ActivityRow[] }): PricingCountry {
  const declared = String(input.declared || 'NG').toUpperCase()
  const m = activityMajority(input.activity)
  const base = { declared, activityCountry: m.total >= ACTIVITY_MIN_OPS ? m.country : null, activityShare: m.share, activityOps: m.total }
  if (input.override && input.override in COUNTRIES) return { ...base, country: input.override, reason: 'override' }
  if (m.country && m.total >= ACTIVITY_MIN_OPS && m.share >= ACTIVITY_MAJORITY && m.country !== declared
    && m.country in COUNTRIES && priceZone(m.country) > priceZone(declared)) {
    return { ...base, country: m.country, reason: 'activity' }
  }
  return { ...base, country: declared, reason: 'declared' }
}

/** Pays de tarification d'une entreprise (lecture serveur, client admin). Table absente (208 non appliquée) : pays déclaré. */
export async function getPricingCountry(admin: any, account: { entityId: string; billing_country?: string | null } | null): Promise<PricingCountry> {
  if (!account?.entityId) return resolvePricingCountry({ declared: account?.billing_country, activity: [] })
  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const [ent, act] = await Promise.all([
    admin.from('entities').select('pricing_country').eq('id', account.entityId).maybeSingle(),
    admin.from('entity_activity_countries').select('country, ops').eq('entity_id', account.entityId).gte('day', since),
  ])
  return resolvePricingCountry({
    declared: account.billing_country,
    override: ent.error ? null : ent.data?.pricing_country ?? null,
    activity: act.error ? [] : act.data || [],
  })
}

/** Code pays de la requête, fourni par l'hébergeur (Vercel) ; jamais un en-tête de l'appareil. null si inconnu. */
export function requestCountry(request: Request): string | null {
  const c = (request.headers.get('x-vercel-ip-country') || '').toUpperCase()
  return /^[A-Z]{2}$/.test(c) && c !== 'XX' && c !== 'T1' ? c : null
}

/** Note l'activité d'une entreprise depuis la requête en cours (ventes, stock, inventaire : 'op' ; connexion : 'login').
 *  Jamais bloquant : une erreur est ignorée (la mesure ne doit jamais empêcher une vente). */
export async function recordActivity(admin: any, request: Request, target: { shopId?: string | null; entityId?: string | null }, kind: 'op' | 'login', count = 1): Promise<void> {
  try {
    const country = requestCountry(request)
    if (!country || count <= 0) return
    let entityId = target.entityId ?? null
    if (!entityId && target.shopId) {
      const { data } = await admin.from('shops').select('entity_id').eq('id', target.shopId).maybeSingle()
      entityId = data?.entity_id ?? null
    }
    if (!entityId) return
    await admin.rpc('bump_entity_activity', { p_entity: entityId, p_country: country, p_ops: kind === 'op' ? count : 0, p_logins: kind === 'login' ? count : 0 })
  } catch { /* mesure seulement : jamais d'échec visible */ }
}
