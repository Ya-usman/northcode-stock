import { Badge, type BadgeProps } from '@/components/ui/badge'

// Statuts de facturation réutilisés partout dans l'admin (Command Center,
// Boutiques, Inspecteur de boutique...) — un seul endroit pour la couleur
// et le libellé de chaque état, au lieu de chaque page réinventant les
// siens (ex. shops-table.tsx et shop-inspector.tsx avaient chacun leur
// propre mapping avant cette refonte).
export type BillingStatus = 'trial' | 'active' | 'grace' | 'expired' | 'suspended' | 'internal'

const STATUS_CONFIG: Record<BillingStatus, { variant: NonNullable<BadgeProps['variant']>; label: string }> = {
  trial:     { variant: 'info',        label: 'Essai' },
  active:    { variant: 'success',     label: 'Actif' },
  grace:     { variant: 'warning',     label: 'Période de grâce' },
  expired:   { variant: 'danger',      label: 'Expiré' },
  suspended: { variant: 'destructive', label: 'Suspendu' },
  internal:  { variant: 'secondary',   label: 'Interne' },
}

export function StatusBadge({ status, className }: { status: BillingStatus; className?: string }) {
  const cfg = STATUS_CONFIG[status]
  return <Badge variant={cfg.variant} className={className}>{cfg.label}</Badge>
}
