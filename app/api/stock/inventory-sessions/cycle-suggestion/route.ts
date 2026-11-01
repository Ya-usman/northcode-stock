import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess } from '@/lib/api/inventory'
import { suggestCycleProducts } from '@/lib/stock/cycle-count-load'
import { normalizeCycleSize } from '@/lib/stock/cycle-count'

// GET /api/stock/inventory-sessions/cycle-suggestion?shop_id=&size= — inventaire tournant (étape 14, 31 oct. 2026) :
// aperçu des produits que le serveur choisirait au démarrage (même règle que POST scope 'cycle'). Noms, unités et
// date du dernier comptage seulement : ni stock (comptage à l'aveugle), ni prix d'achat (sert au classement, jamais renvoyé).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const params = new URL(request.url).searchParams
    const shopId = params.get('shop_id')
    const access = await inventoryAccess(t, shopId, 'view')
    if (!access.ok) return access.response
    const products = await suggestCycleProducts(access.admin, shopId as string, normalizeCycleSize(params.get('size')))
    return NextResponse.json({ products })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
