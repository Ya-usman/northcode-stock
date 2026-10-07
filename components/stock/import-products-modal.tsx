'use client'

// Import de produits : l'écran d'import commun (components/import/import-drawer.tsx)
// réglé sur les produits — même nom et mêmes propriétés qu'avant pour la page Produits.

import { ImportDrawer } from '@/components/import/import-drawer'

interface Props {
  open: boolean
  onClose: () => void
  shopId: string
  onImported: (count: number) => void
}

export function ImportProductsModal(props: Props) {
  return <ImportDrawer kind="products" {...props} />
}
