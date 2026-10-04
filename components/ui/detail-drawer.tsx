'use client'

import * as React from 'react'
import { cn } from '@/lib/utils/cn'
import { AppDrawer, type AppDrawerProps } from '@/components/ui/app-drawer'

// ── DetailDrawer ─────────────────────────────────────────────────────────────
// Panneau de consultation (fiche, lots, journal, historique) : bandeau de
// repères sous l'en-tête (`meta` : statistiques, badges), contenu défilant,
// actions facultatives dans le pied fixe.

export interface DetailDrawerProps extends Omit<AppDrawerProps, 'footer' | 'dirty'> {
  meta?: React.ReactNode
  actions?: React.ReactNode
}

export function DetailDrawer({ meta, actions, children, bodyClassName, ...drawer }: DetailDrawerProps) {
  return (
    <AppDrawer {...drawer} footer={actions} bodyClassName={cn('px-0 py-0', bodyClassName)}>
      {meta && <div className="border-b border-border bg-muted/40 px-5 py-3">{meta}</div>}
      <div className="px-5 py-4">{children}</div>
    </AppDrawer>
  )
}
