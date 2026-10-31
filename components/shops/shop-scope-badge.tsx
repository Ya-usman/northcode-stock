'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Building2, Layers } from 'lucide-react'
import { ShopDot } from '@/components/shops/shop-mark'
import { cn } from '@/lib/utils/cn'
import { useShopScope } from '@/lib/shops/use-shop-scope'

// ── ShopScopeBadge ───────────────────────────────────────────────────────────
// Indicateur discret du périmètre d'une page, près de son titre :
// « Toutes les boutiques » (données agrégées), « Akwa » (une boutique), « Vue entreprise » (page
// volontairement indépendante du sélecteur). Le texte est toujours présent (jamais une icône seule).
// - Compte à une seule boutique : rien (aucun autre périmètre possible, ce serait du bruit).
// - Une boutique : seulement si la page le demande (emphasizeSingle) — sur ordinateur la barre
//   latérale et sur téléphone l'en-tête la montrent déjà ; utile là où les chiffres changent
//   beaucoup (tableau de bord, rapports).
// - count : compteur du même périmètre (« · 38 produits »), jamais un total d'entreprise sous « Akwa ».

export function ShopScopeBadge({
  companyView = false, emphasizeSingle = false, count, className, testId = 'shop-scope-badge',
}: {
  companyView?: boolean
  emphasizeSingle?: boolean
  count?: React.ReactNode
  className?: string
  testId?: string
}) {
  const t = useTranslations('scope')
  const scope = useShopScope({ companyView })
  if (!scope.multiShop) return null
  if (scope.mode === 'single_shop' && !emphasizeSingle) return null

  // Une boutique : point de SA couleur (migration 191) ; « Toutes » et « Vue entreprise » : icône
  const Icon = scope.mode === 'company' ? Building2 : Layers
  const label = scope.mode === 'company' ? t('company_view') : scope.mode === 'all_shops' ? t('all_shops') : scope.shortName

  return (
    <span
      data-testid={testId}
      data-scope-mode={scope.mode}
      title={scope.mode === 'single_shop' ? scope.shopName ?? undefined : undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
        className,
      )}
    >
      {scope.mode === 'single_shop' ? <ShopDot shop={scope.shop} className="h-2.5 w-2.5" /> : <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0 truncate">{label}</span>
      {count != null && <span className="shrink-0 tabular-nums">· {count}</span>}
    </span>
  )
}
