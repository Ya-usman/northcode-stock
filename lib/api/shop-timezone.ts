// Fuseau horaire d'une boutique côté SERVEUR (migration 178) : création et modification passent toutes ici.
// Compatible avant / après la 178 : tant que la colonne shops.timezone n'existe pas, rien n'est envoyé (la base
// actuelle n'en a pas besoin) ; dès qu'elle existe, le fuseau est obligatoire et cohérent avec le pays.
//   • pays à fuseau unique → son fuseau (aucun choix demandé) ;
//   • pays à plusieurs fuseaux → fuseau fourni (choix ou localisation de l'appareil), sinon REFUS
//     shop_timezone_required — jamais déduit du seul pays ;
//   • fuseau fourni incohérent avec le pays → REFUS shop_timezone_invalid.
// La base vérifie la même règle (garde trg_shops_timezone_guard) : défense en profondeur.
import { NextResponse } from 'next/server'
import { resolveShopTimeZone } from '@/lib/time/time-zones'

let columnCache: { at: number; value: boolean } | null = null

/** La colonne shops.timezone existe-t-elle ? (mis en cache 60 s ; bascule seule après l'application de la 178) */
export async function shopsHaveTimezone(admin: any): Promise<boolean> {
  if (columnCache && Date.now() - columnCache.at < 60_000) return columnCache.value
  const { error } = await admin.from('shops').select('timezone').limit(1)
  const value = !error || error.code !== '42703'
  columnCache = { at: Date.now(), value }
  return value
}

type T = (key: any, values?: any) => string
type Result = { ok: true; values: { timezone?: string } } | { ok: false; response: NextResponse }

const refuse = (t: T, key: 'shop_timezone_required' | 'shop_timezone_invalid') =>
  ({ ok: false as const, response: NextResponse.json({ error: t(key), code: key, field: 'timezone' }, { status: 400 }) })

/** Nouvelle boutique : { timezone } à insérer, ou réponse de refus */
export async function timezoneForNewShop(admin: any, t: T, country: string | null | undefined, requested: unknown): Promise<Result> {
  if (!(await shopsHaveTimezone(admin))) return { ok: true, values: {} }
  const r = resolveShopTimeZone({ country, requested })
  if (r.invalid) return refuse(t, 'shop_timezone_invalid')
  if (!r.timezone) return refuse(t, 'shop_timezone_required')
  return { ok: true, values: { timezone: r.timezone } }
}

/**
 * Modification d'une boutique (pays et / ou fuseau) : { timezone } à écrire s'il change, ou réponse de refus.
 * Changement de pays sans nouveau fuseau : l'ancien est gardé s'il reste valable, sinon fuseau unique du nouveau
 * pays, sinon refus (nouveau choix requis) — jamais « France + America/Chicago ».
 */
export async function timezoneForShopUpdate(admin: any, t: T, input: { country: string | null | undefined; requested?: unknown; current?: string | null; countryChanged: boolean; timezoneSent: boolean }): Promise<Result> {
  if (!input.countryChanged && !input.timezoneSent) return { ok: true, values: {} }
  if (!(await shopsHaveTimezone(admin))) return { ok: true, values: {} }
  const r = resolveShopTimeZone({ country: input.country, requested: input.timezoneSent ? input.requested : undefined, current: input.current })
  if (r.invalid) return refuse(t, 'shop_timezone_invalid')
  if (!r.timezone) return refuse(t, 'shop_timezone_required')
  return { ok: true, values: r.timezone !== input.current ? { timezone: r.timezone } : {} }
}
