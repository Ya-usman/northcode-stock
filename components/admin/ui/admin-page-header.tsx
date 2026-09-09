import type { ReactNode } from 'react'

// En-tête standard de page admin — titre + description + zone d'actions
// (boutons, filtres) alignée à droite sur desktop, empilée sur mobile.
// Remplace les en-têtes ad hoc répétés en haut de chaque page admin.
export function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}
