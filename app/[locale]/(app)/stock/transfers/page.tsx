'use client'

import { PageHeader } from '@/components/layout/page-header'
import { useTranslations } from 'next-intl'
import { ArrowRightLeft } from 'lucide-react'
import { StockTransfersTab } from '@/components/stock/stock-transfers-tab'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { useEntityMultiShop } from '@/lib/hooks/use-entity-multi-shop'

export default function StockTransfersPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('nav')
  const tPage = useTranslations('page_header')
  const { canAccess } = useRolePermissions()

  // Entreprise à une seule boutique : rien à transférer ; plusieurs (même si la personne n'en gère qu'une) : demandes reçues.
  // Mêmes rôles que les bons de commande fournisseurs (PermFeature 'transfers').
  const entityMultiShop = useEntityMultiShop()
  const isAuthorized = canAccess('transfers') && entityMultiShop

  if (!isAuthorized) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ArrowRightLeft className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm">{t('no_access')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('transfers')} description={tPage('stock_transfers')} />
      <StockTransfersTab />
    </div>
  )
}
