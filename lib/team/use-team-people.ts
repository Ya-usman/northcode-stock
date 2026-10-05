'use client'

// Chargement de l'équipe REGROUPÉE PAR PERSONNE — source unique pour la page
// Équipe (vue globale) et l'onglet Équipe d'une fiche boutique (refonte du
// 5 oct. 2026). Une personne affectée à plusieurs boutiques = UNE entrée avec
// la liste de ses affectations (rôle par boutique).
//
// Isolation : la requête passe par le client utilisateur (RLS shop_members :
// seulement les boutiques dont l'appelant est membre) et n'interroge que les
// boutiques demandées — un Manager ou un Responsable ne voit donc que les
// personnes de ses boutiques.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { UserRole } from '@/lib/types/database'
import { ROLE_ORDER } from './roles'

const supabase = createClient() as any

export interface TeamMembership {
  id: string
  shop_id: string
  role: UserRole
  is_active: boolean
  joined_at: string | null
}

export interface TeamPerson {
  user_id: string
  full_name: string
  phone: string | null
  last_seen: string | null
  /** Compte actif (profiles.is_active) — false = compte désactivé */
  accountActive: boolean
  /** Boutique principale (profiles.shop_id) */
  primaryShopId: string | null
  /** Affectations ACTIVES dans les boutiques chargées */
  memberships: TeamMembership[]
  /** Affectations coupées par la désactivation du compte (affichées grisées) */
  suspendedMemberships: TeamMembership[]
  email?: string | null
  emailConfirmedAt?: string | null
  lastSignInAt?: string | null
}

export function isPendingInvite(p: TeamPerson): boolean {
  return p.email !== undefined && !p.emailConfirmedAt
}

/** Rôle « le plus élevé » d'une personne (ordre propriétaire → observateur) */
export function topRole(p: TeamPerson): UserRole | null {
  const roles = (p.memberships.length ? p.memberships : p.suspendedMemberships).map(m => m.role)
  return ROLE_ORDER.find(r => roles.includes(r)) ?? null
}

/**
 * @param shopIds boutiques à charger (celles que l'appelant gère)
 * @param statusShopId boutique de contexte pour /api/team/status (e-mails) — une boutique gérée par l'appelant
 */
export function useTeamPeople(shopIds: string[], statusShopId: string | null | undefined) {
  const key = [...shopIds].sort().join(',')
  const cacheKey = `team_people_${key}`
  const [people, setPeople] = useState<TeamPerson[]>(() => getPageCache<TeamPerson[]>(cacheKey) || [])
  const [loading, setLoading] = useState(() => !getPageCache(cacheKey))
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    if (!shopIds.length) { setPeople([]); setLoading(false); return }
    try {
      const { data: rows, error: rowsErr } = await withTimeout<any>(
        supabase.from('shop_members')
          .select('id, user_id, shop_id, role, is_active, joined_at')
          .in('shop_id', shopIds),
        20_000, 'Chargement de l\'équipe trop lent — réessayez.'
      )
      if (rowsErr) throw rowsErr
      const userIds = Array.from(new Set((rows || []).map((r: any) => r.user_id))) as string[]
      const { data: profiles } = userIds.length
        ? await withTimeout<any>(supabase.from('profiles').select('id, full_name, phone, last_seen, is_active, shop_id').in('id', userIds), 20_000)
        : { data: [] }
      const P: Record<string, any> = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]))

      const byUser = new Map<string, TeamPerson>()
      for (const r of (rows || []) as any[]) {
        const prof = P[r.user_id]
        const accountActive = prof?.is_active !== false
        const m: TeamMembership = { id: r.id, shop_id: r.shop_id, role: r.role, is_active: r.is_active, joined_at: r.joined_at }
        // Affectation retirée (inactive, compte actif) : la personne n'est plus dans cette boutique
        if (!r.is_active && accountActive) continue
        let p = byUser.get(r.user_id)
        if (!p) {
          p = {
            user_id: r.user_id,
            full_name: prof?.full_name || '—',
            phone: prof?.phone ?? null,
            last_seen: prof?.last_seen ?? null,
            accountActive,
            primaryShopId: prof?.shop_id ?? null,
            memberships: [],
            suspendedMemberships: [],
          }
          byUser.set(r.user_id, p)
        }
        if (r.is_active) p.memberships.push(m)
        else p.suspendedMemberships.push(m)
      }
      let list = Array.from(byUser.values())
        .sort((a, b) => a.full_name.localeCompare(b.full_name))

      // E-mails et état d'invitation (gestion d'équipe seulement ; non bloquant)
      if (statusShopId && list.length) {
        try {
          const res = await withTimeout(fetch('/api/team/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_ids: list.map(p => p.user_id), shop_id: statusShopId }),
          }), 15_000)
          if (res.ok) {
            const { status } = await res.json()
            list = list.map(p => status[p.user_id] ? {
              ...p,
              email: status[p.user_id].email,
              emailConfirmedAt: status[p.user_id].email_confirmed_at,
              lastSignInAt: status[p.user_id].last_sign_in_at,
            } : p)
          }
        } catch { /* e-mails facultatifs */ }
      }

      setPeople(list)
      setPageCache(cacheKey, list)
      setError(false)
    } catch {
      setError(true) // le cache éventuel reste affiché
    } finally {
      setLoading(false)
    }
  }, [key, statusShopId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refresh() }, [refresh])

  const byId = useMemo(() => new Map(people.map(p => [p.user_id, p])), [people])
  return { people, byId, loading, error, refresh }
}
