'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Store } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import type { Shop } from '@/lib/types/database'

// ── Choix explicite d'une boutique ───────────────────────────────────────────
// Pour une action qui écrit dans UNE boutique (inventaire, nouvelle dépense, nouvelle vente…) lancée
// depuis « Toutes les boutiques » : la personne choisit la boutique, toujours. Jamais de boutique
// active cachée, précédente ou mémorisée choisie en silence (voir useShopScope().requireOneShop).
// Monté une seule fois dans la mise en page de l'application ; appelé via useShopPicker().pick().

export interface ShopPickOptions {
  /** Question posée (« Dans quelle boutique voulez-vous démarrer l'inventaire ? ») ; défaut : « Dans quelle boutique ? » */
  title?: string
  description?: string
  /** Boutiques proposées (ex. celles où la personne a le droit d'agir) ; défaut : toutes ses boutiques */
  shops: Shop[]
}

type Pick = (options: ShopPickOptions) => Promise<Shop | null>
const ShopPickerContext = React.createContext<Pick | null>(null)

export function ShopPickerProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('scope')
  const tActions = useTranslations('actions')
  const [request, setRequest] = React.useState<(ShopPickOptions & { resolve: (s: Shop | null) => void }) | null>(null)

  const pick = React.useCallback<Pick>(options => new Promise(resolve => {
    setRequest(prev => { prev?.resolve(null); return { ...options, resolve } })
  }), [])
  const finish = (shop: Shop | null) => {
    request?.resolve(shop)
    setRequest(null)
  }

  return (
    <ShopPickerContext.Provider value={pick}>
      {children}
      <PremiumDialog
        open={!!request}
        onOpenChange={open => { if (!open) finish(null) }}
        title={request?.title || t('pick_title')}
        description={request?.description}
        icon={<Store className="h-4 w-4" />}
      >
        <PremiumDialogBody>
          <div className="space-y-1.5" role="list" data-testid="shop-picker">
            {(request?.shops ?? []).map(s => (
              <button
                key={s.id}
                type="button"
                role="listitem"
                onClick={() => finish(s)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:border-stockshop-blue hover:bg-stockshop-blue-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stockshop-blue/40 dark:hover:border-blue-500 dark:hover:bg-blue-950/40"
                data-shop-option={s.id}
              >
                <Store aria-hidden className="h-4 w-4 shrink-0 text-stockshop-blue dark:text-blue-400" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{s.name}</span>
                  {s.city && <span className="block truncate text-xs text-muted-foreground">{s.city}</span>}
                </span>
              </button>
            ))}
            {request && request.shops.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('pick_none')}</p>
            )}
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => finish(null)} cancelLabel={tActions('cancel')} />
      </PremiumDialog>
    </ShopPickerContext.Provider>
  )
}

export function useShopPicker(): Pick {
  const pick = React.useContext(ShopPickerContext)
  if (!pick) throw new Error('useShopPicker : ShopPickerProvider manquant')
  return pick
}
