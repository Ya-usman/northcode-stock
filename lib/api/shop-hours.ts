// ── Horaires de boutique, côté SERVEUR (décision du 29 oct. 2026, lot A) ─────────────────────────────────────────
// Boutique fermée (horaires activés, hors fenêtre, à l'heure de la BOUTIQUE — son fuseau shops.timezone — dérogation
// manuelle et prolongation comprises) → les EMPLOYÉS ne peuvent plus écrire ses données par l'API. Même règle que le mur
// de l'écran (lib/saas/shop-hours → isShopOpenNow) : en cas de doute (données absentes ou incohérentes), ouvert.
// Exemptés : propriétaire et super admin (comme le mur). Toujours permis : demander une prolongation (extend_hours) et
// la synchronisation des ventes faites hors ligne (jamais refusée ; marquée « à vérifier » si hors horaires).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isShopOpenNow } from '@/lib/saas/shop-hours'

export const HOURS_EXEMPT_ROLES: readonly string[] = ['owner', 'super_admin']

export interface ShopHoursState { open: boolean; opening: string | null; closing: string | null }

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : null)

/** État d'ouverture d'une boutique MAINTENANT, à son heure locale. Fail-open sur toute erreur de lecture. */
export async function shopHoursState(shopId: string, now: Date = new Date()): Promise<ShopHoursState> {
  try {
    const admin = await createAdminClient() as any
    const { data: s } = await admin.from('shops')
      .select('hours_enabled, opening_time, closing_time, hours_manual_override, hours_extension_until, timezone')
      .eq('id', shopId).maybeSingle()
    if (!s) return { open: true, opening: null, closing: null }
    const open = isShopOpenNow(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until, now, s.timezone)
    return { open, opening: hhmm(s.opening_time), closing: hhmm(s.closing_time) }
  } catch {
    return { open: true, opening: null, closing: null }
  }
}

/** Fermée POUR CE RÔLE (employé) : l'état de la boutique ; sinon null (ouverte, ou rôle exempté). */
export async function closedFor(shopId: string | null | undefined, role: string | null | undefined): Promise<ShopHoursState | null> {
  if (!shopId || !role || HOURS_EXEMPT_ROLES.includes(role)) return null
  const state = await shopHoursState(shopId)
  return state.open ? null : state
}

/** Réponse 403 explicite « boutique fermée » (code shop_closed) si fermée pour ce rôle ; sinon null. */
export async function shopClosedResponse(
  t: (key: any, values?: any) => string, shopId: string | null | undefined, role: string | null | undefined,
): Promise<NextResponse | null> {
  const closed = await closedFor(shopId, role)
  if (!closed) return null
  return NextResponse.json(
    { error: t('shop_closed', { opening: closed.opening ?? '—', closing: closed.closing ?? '—' }), code: 'shop_closed' },
    { status: 403 },
  )
}
