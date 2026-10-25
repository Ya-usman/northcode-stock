'use client'
// Garde d'entrée des écrans : sans le droit « voir » de la fonction (même règle que le menu, useNavAccess), l'écran
// n'est PAS rendu — aucune donnée n'est donc lue — et « Accès non autorisé » s'affiche à la place. Couvre aussi
// l'accès direct par l'adresse. Correspondance adresse → fonction : lib/navigation/route-access.
import { useTranslations } from 'next-intl'
import { ShieldOff } from 'lucide-react'
import { useNavAccess } from '@/lib/hooks/use-role-permissions'
import { ruleForPath } from '@/lib/navigation/route-access'

export function RouteGuard({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const t = useTranslations('nav')
  const navAccess = useNavAccess()
  const rule = ruleForPath(pathname)
  if (!rule || navAccess(rule.feature)) return <>{children}</>
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center" data-testid="route-no-access" data-feature={rule.feature}>
      <ShieldOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{t('no_access')}</p>
    </div>
  )
}
