import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getAuthedUser() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  // Use getSession() — reads JWT from cookies locally, no network call.
  // getUser() makes a round-trip to Supabase and can return null on timeout.
  const { data: { session } } = await supabase.auth.getSession()
  return { user: session?.user ?? null, supabase }
}

async function checkShopRole(supabase: any, userId: string, shopId: string) {
  const { data: member } = await supabase
    .from('shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', userId).eq('is_active', true).single()
  if (member?.role) return member.role
  const { data: profile } = await supabase
    .from('profiles').select('role, shop_id').eq('id', userId).single()
  if (profile?.role === 'super_admin') return 'super_admin'
  if (profile?.shop_id === shopId) return profile.role
  return null
}

const KEYWORD_MAP: { keywords: string[]; category: string }[] = [
  {
    category: 'Alimentation',
    keywords: [
      'riz', 'rice', 'farine', 'flour', 'sucre', 'sugar', 'sel', 'salt',
      'huile', 'oil', 'indomie', 'noodle', 'tomat', 'haricot', 'bean',
      'maggi', 'semovita', 'gari', 'maïs', 'mais', 'corn', 'igname', 'yam',
      'manioc', 'cassava', 'arachide', 'groundnut', 'peanut',
    ],
  },
  {
    category: 'Boissons',
    keywords: [
      'boisson', 'beverage', 'coca', 'coke', 'pepsi', 'fanta', 'sprite',
      'jus', 'juice', 'eau', 'water', 'lait', 'milk', 'milo', 'lipton',
      'thé', 'the', 'tea', 'malt', 'bière', 'biere', 'beer',
      'bissap', 'ginger', 'zobo',
    ],
  },
  {
    category: 'Cosmétiques',
    keywords: [
      'savon', 'soap', 'shampoo', 'shampoing', 'crème', 'creme', 'cream',
      'nivea', 'vaseline', 'parfum', 'perfume', 'déodorant', 'deodorant',
      'dentifrice', 'toothpaste', 'brosse', 'brush', 'coton', 'cotton',
      'rasoir', 'razor', 'lotion',
    ],
  },
  {
    category: 'Ménager',
    keywords: [
      'lessive', 'deterg', 'déterg', 'balai', 'broom', 'seau', 'bucket',
      'allumette', 'match', 'bougie', 'candle', 'mop', 'serpillière',
      'éponge', 'eponge', 'sponge', 'javel', 'bleach', 'ajax', 'omo', 'tide',
      'plastique', 'plastic', 'poubelle', 'basin', 'cuvette',
    ],
  },
  {
    category: 'Papeterie',
    keywords: [
      'cahier', 'notebook', 'stylo', 'pen', 'bic', 'crayon', 'pencil',
      'règle', 'regle', 'ruler', 'ciseau', 'scissors', 'colle', 'glue',
      'papier', 'paper', 'classeur', 'enveloppe', 'marqueur', 'marker', 'gomme',
    ],
  },
]

// GET /api/categories?shop_id=xxx
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const shop_id = searchParams.get('shop_id')
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('categories').select('*').eq('shop_id', shop_id).order('name')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/categories — ajouter une catégorie
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { shop_id, name } = await request.json()
    if (!shop_id || !name) return NextResponse.json({ error: 'shop_id et name requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !['owner', 'stock_manager', 'super_admin'].includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('categories').insert({ shop_id, name }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PUT /api/categories — restaurer les catégories par défaut + assigner les produits
export async function PUT(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { shop_id } = await request.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !['owner', 'stock_manager', 'super_admin'].includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()

    // 1. Créer les catégories manquantes
    const DEFAULT_CATEGORIES = ['Alimentation', 'Boissons', 'Cosmétiques', 'Ménager', 'Papeterie']
    const { data: existing } = await (admin as any).from('categories').select('id, name').eq('shop_id', shop_id)
    const existingNames = new Set((existing || []).map((c: any) => c.name.toLowerCase()))
    const toInsert = DEFAULT_CATEGORIES
      .filter(name => !existingNames.has(name.toLowerCase()))
      .map(name => ({ shop_id, name }))

    let inserted: any[] = []
    if (toInsert.length > 0) {
      const { data: ins } = await (admin as any).from('categories').insert(toInsert).select()
      inserted = ins || []
    }

    // 2. Construire la map nom → id
    const allCategories: { id: string; name: string }[] = [...(existing || []), ...inserted]
    const catMap = new Map<string, string>()
    for (const c of allCategories) catMap.set(c.name.toLowerCase(), c.id)

    // 3. Assigner les produits sans catégorie
    const { data: products } = await (admin as any)
      .from('products').select('id, name').eq('shop_id', shop_id).is('category_id', null)

    let assigned = 0
    for (const product of (products || [])) {
      const nameLower = product.name.toLowerCase()
      for (const { keywords, category } of KEYWORD_MAP) {
        const catId = catMap.get(category.toLowerCase())
        if (!catId) continue
        if (keywords.some(kw => nameLower.includes(kw))) {
          await (admin as any).from('products').update({ category_id: catId }).eq('id', product.id)
          assigned++
          break
        }
      }
    }

    return NextResponse.json({ ok: true, categoriesCreated: inserted.length, productsAssigned: assigned })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/categories?id=xxx
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const shop_id = searchParams.get('shop_id')
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !['owner', 'stock_manager', 'super_admin'].includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const admin = await createAdminClient()
    const { error } = await (admin as any).from('categories').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
