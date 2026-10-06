'use client'

// Nouveautés V2 (migration 162) — règles d'affichage, en un seul endroit :
//  - visibles : actives, non expirées, destinées au rôle de la boutique active
//    (roles null = tout le monde ; super_admin voit tout) ;
//  - texte dans la langue de l'interface (repli : français) ;
//  - point « non lu » : publiée après la dernière ouverture du panneau (ou,
//    jamais ouvert, après la création du compte : pas d'historique ancien en
//    « nouveau » pour un compte récent) ;
//  - bandeau de page : la plus récente annonce de moins de 30 jours dont la
//    page (target_path) correspond, non fermée par la personne ;
//  - badge « Nouveau » du menu : 14 jours, tant que le bandeau n'est pas fermé.
// Écritures : ouverture du panneau = son profil (last_seen_announcement_at,
// règle profiles_update_own) ; fermeture d'un bandeau = /api/announcements/dismiss.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types/database'
import { TOUR_IDS, type TourId } from '@/lib/onboarding/tours'

const supabase = createClient() as any
const DAY = 86_400_000
const BANNER_DAYS = 30
const NAV_BADGE_DAYS = 14

export type AnnouncementKind = 'new' | 'improvement' | 'fix'

export interface AnnouncementRow {
  id: string
  title: string
  description: string
  title_en?: string | null
  title_ha?: string | null
  description_en?: string | null
  description_ha?: string | null
  kind?: AnnouncementKind | null
  cta_path?: string | null
  target_path?: string | null
  tour_id?: string | null
  roles?: string[] | null
  expires_at?: string | null
  published_at: string
}

export interface Announcement {
  id: string
  title: string
  description: string
  kind: AnnouncementKind
  ctaPath: string | null
  targetPath: string | null
  /** Tour guidé proposé (« Me montrer »), migration 165 */
  tourId: TourId | null
  publishedAt: string
  unread: boolean
}

function localized(a: AnnouncementRow, locale: string): { title: string; description: string } {
  if (locale === 'en') return { title: a.title_en || a.title, description: a.description_en || a.description }
  if (locale === 'ha') return { title: a.title_ha || a.title, description: a.description_ha || a.description }
  return { title: a.title, description: a.description }
}

/** Chemin de l'app sans la langue : « /fr/stock/transfers » → « stock/transfers » */
export const appPath = (pathname: string) => pathname.replace(/^\/(fr|en|ha)(?=\/|$)/, '').replace(/^\//, '')
const matchesPage = (path: string, target: string) => path === target || path.startsWith(target + '/')

export function useAnnouncements(profile: Profile | null, role: string | null | undefined, locale: string) {
  const [rows, setRows] = useState<AnnouncementRow[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [seenAt, setSeenAt] = useState<string | null>(profile?.last_seen_announcement_at ?? null)
  const profileId = profile?.id

  useEffect(() => { setSeenAt(profile?.last_seen_announcement_at ?? null) }, [profile?.last_seen_announcement_at])

  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    ;(async () => {
      const [ann, dis] = await Promise.all([
        supabase.from('announcements').select('*').eq('is_active', true).order('published_at', { ascending: false }).limit(30),
        supabase.from('announcement_dismissals').select('announcement_id').eq('user_id', profileId),
      ])
      if (cancelled) return
      if (!ann.error) setRows((ann.data || []) as AnnouncementRow[])
      // Table absente (migration pas encore appliquée) : aucune fermeture connue
      if (!dis.error) setDismissed(new Set((dis.data || []).map((d: any) => d.announcement_id)))
    })().catch(() => {})
    return () => { cancelled = true }
  }, [profileId])

  const items: Announcement[] = useMemo(() => {
    const now = Date.now()
    const cursor = Math.max(seenAt ? new Date(seenAt).getTime() : 0, profile?.created_at ? new Date(profile.created_at).getTime() : 0)
    return rows
      .filter(a => new Date(a.published_at).getTime() <= now) // programmée : pas avant sa date
      .filter(a => !a.expires_at || new Date(a.expires_at).getTime() > now)
      .filter(a => role === 'super_admin' || !a.roles?.length || (!!role && a.roles.includes(role)))
      .map(a => ({
        id: a.id,
        ...localized(a, locale),
        kind: (a.kind || 'new') as AnnouncementKind,
        ctaPath: a.cta_path || null,
        targetPath: a.target_path || null,
        tourId: a.tour_id && (TOUR_IDS as string[]).includes(a.tour_id) ? (a.tour_id as TourId) : null,
        publishedAt: a.published_at,
        unread: new Date(a.published_at).getTime() > cursor,
      }))
  }, [rows, role, locale, seenAt, profile?.created_at])

  const hasUnread = items.some(a => a.unread)

  /** Panneau ouvert : tout est vu (enregistré sur son profil) */
  const markAllSeen = useCallback(async () => {
    if (!profileId || !hasUnread) return
    const now = new Date().toISOString()
    setSeenAt(now)
    try { await supabase.from('profiles').update({ last_seen_announcement_at: now }).eq('id', profileId) } catch { /* non bloquant */ }
  }, [profileId, hasUnread])

  const isRecent = (a: Announcement, days: number) => Date.now() - new Date(a.publishedAt).getTime() < days * DAY

  /** Bandeau de la page courante (une seule annonce à la fois) */
  const bannerFor = useCallback((pathname: string): Announcement | null => {
    const path = appPath(pathname)
    return items.find(a => a.targetPath && matchesPage(path, a.targetPath) && isRecent(a, BANNER_DAYS) && !dismissed.has(a.id)) ?? null
  }, [items, dismissed]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Pages du menu qui portent le badge « Nouveau » (chemins sans langue) */
  const newNavPaths = useMemo(() => new Set(
    items.filter(a => a.targetPath && isRecent(a, NAV_BADGE_DAYS) && !dismissed.has(a.id)).map(a => a.targetPath!.split('/')[0]),
  ), [items, dismissed]) // eslint-disable-line react-hooks/exhaustive-deps

  const dismiss = useCallback(async (id: string) => {
    setDismissed(prev => new Set(prev).add(id))
    try {
      await fetch('/api/announcements/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ announcement_id: id }) })
    } catch { /* déjà masqué ici ; réessayé à la prochaine fermeture */ }
  }, [])

  return { items, hasUnread, markAllSeen, bannerFor, newNavPaths, dismiss }
}
