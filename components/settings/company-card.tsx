'use client'

// Carte « Entreprise » en tête des Paramètres : nom de l'entreprise (racine du
// compte, migration 153) et invitation discrète à confirmer le nom provisoire.
// Ouvre Paramètres → Entreprise.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Building2, ChevronRight } from 'lucide-react'
import { useAuthContext } from '@/lib/contexts/auth-context'

export function CompanyCard() {
  const t = useTranslations()
  const locale = useLocale()
  const { shop } = useAuthContext()
  const [entity, setEntity] = useState<{ name: string; name_confirmed: boolean } | null>(null)

  useEffect(() => {
    if (!shop?.id) return
    fetch(`/api/entity?shop_id=${shop.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j?.entity) setEntity({ name: j.entity.name, name_confirmed: j.entity.name_confirmed }) })
      .catch(() => {})
  }, [shop?.id])

  if (!entity) return null
  return (
    <Link href={`/${locale}/settings/company`} data-testid="settings-company-card"
      className="flex items-center gap-3 rounded-lg bg-card p-4 shadow-sm transition-colors hover:bg-accent/40">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-stockshop-blue/10">
        <Building2 className="h-5 w-5 text-stockshop-blue dark:text-blue-400" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{t('entity.label')}</span>
        <span className="block truncate text-sm font-semibold">{entity.name}</span>
        {!entity.name_confirmed && <span className="mt-0.5 block text-xs font-medium text-amber-600 dark:text-amber-400">{t('entity.confirm_title')}</span>}
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </Link>
  )
}
