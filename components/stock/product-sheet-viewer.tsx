'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Product } from '@/lib/types/database'
import { createClient } from '@/lib/supabase/client'
import { ProductDetailDrawer } from '@/components/stock/product-detail-drawer'
import type { ProductStatus } from '@/components/stock/product-table'
import { PRODUCT_PUBLIC_COLUMNS } from '@/lib/products/columns'
import { isPromoActive, stockLevelOf } from '@/lib/stock/signals'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useCurrency } from '@/lib/hooks/use-currency'
import { toast } from '@/components/ui/use-toast'

// La fiche produit, ouverte EN CONSULTATION depuis un autre écran que la liste
// des produits (détail d'un mouvement). C'est la même fiche
// (ProductDetailDrawer) : mêmes chiffres, calculés par le serveur. Elle ne
// propose ici aucune action de modification — celles-ci restent dans
// Stock → Produits, où se trouvent leurs fenêtres. Le prix d'achat n'est pas
// lu par le navigateur : le serveur ne l'ajoute à la fiche que pour qui en a
// le droit.

const NOOP = () => {}

export function ProductSheetViewer({ productId, onClose }: { productId: string | null; onClose: () => void }) {
  const t = useTranslations()
  const { userShops } = useAuth()
  const { fmt } = useCurrency()
  const [product, setProduct] = useState<Product | null>(null)
  const [batches, setBatches] = useState<any[]>([])
  const [loadingBatches, setLoadingBatches] = useState(false)

  useEffect(() => {
    setProduct(null)
    setBatches([])
    if (!productId) return
    let alive = true
    const supabase = createClient() as any
    setLoadingBatches(true)
    supabase.from('products').select(`${PRODUCT_PUBLIC_COLUMNS}, categories(name, color)`).eq('id', productId).maybeSingle()
      .then(({ data }: any) => {
        if (!alive) return
        if (data) setProduct(data as Product)
        else { toast({ title: t('toast.error'), variant: 'destructive' }); onClose() }
      })
    supabase.from('product_batches')
      .select('id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at, created_at, updated_at, promo_price, promo_until, promo_start')
      .eq('product_id', productId).gt('quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false }).order('received_at', { ascending: true })
      .then(({ data }: any) => { if (alive) { setBatches(data || []); setLoadingBatches(false) } })
    return () => { alive = false }
  }, [productId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Statut affiché à l'ouverture, remplacé par celui du serveur dès qu'il arrive
  const level = product ? stockLevelOf(product, { shopLowStockThreshold: userShops.find(s => s.id === product.shop_id)?.low_stock_threshold }) : 'ok'
  const statusLabels: Record<ProductStatus, string> = { out: t('status.out_of_stock'), low: t('status.low_stock'), dormant: t('products.card_dormant'), ok: t('status.in_stock') }

  return (
    <ProductDetailDrawer
      product={product}
      onClose={onClose}
      section="top"
      refreshKey={0}
      status={level as ProductStatus}
      statusLabels={statusLabels}
      promoActive={!!product && isPromoActive(product)}
      formatPrice={fmt}
      batches={{ batches, loading: loadingBatches, canWrite: false, onAdjust: NOOP, onPromo: NOOP, onDelete: NOOP, onEditExpiry: NOOP }}
      actions={{}}
      onChanged={NOOP}
    />
  )
}
