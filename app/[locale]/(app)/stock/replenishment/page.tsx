'use client'

import { PageHeader } from '@/components/layout/page-header'
import { useTranslations } from 'next-intl'
import { PackagePlus } from 'lucide-react'
import { ReplenishmentTab } from '@/components/stock/replenishment/replenishment-tab'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'

// Stock › Réapprovisionnement : produits à commander, regroupés par fournisseur (étape 12). Consultation avec le droit
// Stock ; la création des bons demande Fournisseurs en modification (vérifié par le serveur, boutique par boutique).
export default function StockReplenishmentPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('nav')
  const tPage = useTranslations('page_header')
  const { canAccess } = useRolePermissions()

  if (!canAccess('stock')) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <PackagePlus className="mb-4 h-12 w-12 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{t('no_access')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('replenishment')} description={tPage('stock_replenishment')} />
      <ReplenishmentTab />
    </div>
  )
}
