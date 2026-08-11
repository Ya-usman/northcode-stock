'use client'

import { useTranslations } from 'next-intl'
import { ArrowRightLeft } from 'lucide-react'
import { StockTabs } from '@/components/stock/stock-tabs'
import { StockTransfersTab } from '@/components/stock/stock-transfers-tab'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'

export default function StockTransfersPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('nav')
  const { userShops } = useAuth()
  const { canAccess } = useRolePermissions()

  // Sans intérêt pour un compte à une seule boutique — rien à transférer.
  // Mêmes rôles que les bons de commande fournisseurs (PermFeature 'transfers').
  const isAuthorized = canAccess('transfers') && userShops.length > 1

  if (!isAuthorized) {
    return (
      <div className="space-y-4">
        <StockTabs locale={locale} />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <ArrowRightLeft className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm">{t('no_access')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StockTabs locale={locale} />
      <StockTransfersTab />
    </div>
  )
}
