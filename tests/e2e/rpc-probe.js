// Sonde de la caisse — À LANCER après toute migration qui touche aux ventes, au stock ou à une fonction
// SECURITY DEFINER (incident du 6 oct. 2026 : complete_sale cassée par une fonction d'extension, toutes les ventes
// refusées pendant ~16 h sans qu'aucun test ne le voie, car ils interceptent les écritures).
// Appelle complete_sale sur Boutique Alpha avec un 1er article valide et un 2e en quantité IMPOSSIBLE : la base
// doit tout annuler — erreur « Stock insuffisant » (P0001) attendue, JAMAIS une autre erreur ; nombre de ventes,
// lignes, lots et stock inchangés. Aucune trace ne peut rester (transaction annulée par la base elle-même).
// Usage : node tests/e2e/rpc-probe.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ALPHA = 'a0000000-0000-0000-0000-000000000001'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

async function snapshot(ids) {
  const [{ count: sales }, { data: prods }, { data: lots }] = await Promise.all([
    db.from('sales').select('id', { count: 'exact', head: true }).eq('shop_id', ALPHA),
    db.from('products').select('id, quantity').in('id', ids).order('id'),
    db.from('product_batches').select('id, quantity').in('product_id', ids).order('id'),
  ])
  return JSON.stringify({ sales, prods, lots })
}

;(async () => {
  const { data: shop } = await db.from('shops').select('id, name').eq('id', ALPHA).single()
  if (!shop) throw new Error('Boutique Alpha introuvable')
  const { data: prods } = await db.from('products').select('id, name, quantity, selling_price').eq('shop_id', ALPHA).eq('is_active', true).gt('quantity', 0).order('quantity', { ascending: false }).limit(2)
  if (!prods || prods.length < 2) throw new Error('Il faut 2 produits en stock sur Alpha')
  const [a, b] = prods
  const before = await snapshot([a.id, b.id])
  const { data: cashier } = await db.from('shop_members').select('user_id').eq('shop_id', ALPHA).eq('is_active', true).limit(1).single()

  const items = [
    { product_id: a.id, product_name: a.name, quantity: 1, unit_price: Number(a.selling_price) || 1, buying_price: 0 },
    { product_id: b.id, product_name: b.name, quantity: b.quantity + 100000, unit_price: 1, buying_price: 0 },
  ]
  const total = items.reduce((n, i) => n + i.quantity * i.unit_price, 0)
  const { data, error } = await db.rpc('complete_sale', {
    p_shop_id: ALPHA, p_cashier_id: cashier.user_id, p_customer_id: null, p_customer_name: null, p_customer_phone: null,
    p_subtotal: total, p_discount: 0, p_tax: 0, p_total: total, p_payment_method: 'cash', p_notes: 'SONDE rpc-probe',
    p_paystack_reference: null, p_client_request_id: `rpc-probe-${Date.now()}`, p_items: items, p_payments: [],
    p_due_date: null, p_created_at: null, p_receipt_token: null, p_review_reason: null,
  })
  console.log(`  réponse : code ${error?.code} — ${String(error?.message || '').slice(0, 120)}`)
  ok(!data && error && error.code === 'P0001' && /Stock insuffisant/.test(error.message), 'vente refusée par « Stock insuffisant » (P0001), aucune autre erreur')
  ok(await snapshot([a.id, b.id]) === before, 'ventes, stock produit et lots inchangés (tout annulé par la base)')
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
