'use client'

import * as React from 'react'
import { ShopScopeBadge } from '@/components/shops/shop-scope-badge'
import { cn } from '@/lib/utils/cn'

// ── PageHeader ───────────────────────────────────────────────────────────────
// En-tête commun des pages et des onglets (validé le 31 oct. 2026, modèle : Stock › Vue d'ensemble) :
// titre à gauche, pastille de la boutique à droite, phrase qui dit à quoi sert la page.
// - scope 'shop' : pastille « Akwa » ou « Toutes les boutiques », pour que l'utilisateur sache toujours où il
//   travaille ; cachée pour un compte à une seule boutique (ShopScopeBadge).
// - scope 'entity' : page de l'entreprise (Boutiques, Équipe, Abonnement…) : jamais de pastille, elle
//   laisserait croire que la page ne concerne qu'une boutique.
// - actions : boutons propres à la page, alignés à droite du titre (facultatif).

export function PageHeader({
  title, description, scope = 'shop', badge = true, actions, className, badgeTestId = 'shop-scope-badge',
}: {
  title: React.ReactNode
  description?: React.ReactNode
  scope?: 'shop' | 'entity'
  /** false : la page affiche déjà la boutique de façon plus explicite (Inventaires) */
  badge?: boolean
  actions?: React.ReactNode
  className?: string
  /** Repère de test de la pastille (la Vue d'ensemble garde « overview-shop-context ») */
  badgeTestId?: string
}) {
  return (
    <div className={cn('min-w-0', className)} data-testid="page-header">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-lg font-semibold leading-tight">{title}</h1>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {scope === 'shop' && badge && <ShopScopeBadge emphasizeSingle testId={badgeTestId} className="min-w-0 max-w-[55vw] sm:max-w-xs" />}
          {actions}
        </div>
      </div>
      {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
