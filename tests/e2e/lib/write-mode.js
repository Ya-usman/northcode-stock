// Mode ÉCRITURE explicite pour les tests qui DOIVENT écrire en base (validé le 23 oct. 2026).
//
// Activé dans le code d'UN test (enableWrite({ test, routes })), jamais par une variable d'environnement seule.
//   • serveur LOCAL uniquement : toute autre adresse (ou CAPTURE_PROD_READONLY) → arrêt immédiat, avant toute connexion ;
//   • Boutique Alpha uniquement : avant la première écriture, la base confirme que la boutique cible est bien
//     « Boutique Alpha » (identifiant, nom, propriétaire du compte d'essai) — sinon arrêt ;
//   • navigateur : seules les routes déclarées par le test passent, et seulement si la requête vise Alpha
//     (shop_id dans la requête = Alpha) ; ventes (encaissement, synchronisation hors ligne) TOUJOURS bloquées ;
//   • référence unique par exécution (W.RUN) pour tout ce que le test crée ;
//   • nettoyage : uniquement des lignes NOUVELLES (absentes de la photo de départ), de la boutique Alpha, et
//     rattachées au test (prédicat fourni par le test) — jamais de suppression large ;
//   • photo complète d'Alpha avant / après : aucune ligne préexistante supprimée ni modifiée, aucune trace restante.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ALPHA = 'a0000000-0000-0000-0000-000000000001'
const ALPHA_NAME = 'Boutique Alpha'
const ALPHA_OWNER = 'admin@northcode.ng'
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
// Tables photographiées (filtre shop_id = Alpha), puis tables liées sans shop_id
const SHOP_TABLES = [
  'audit_logs', 'categories', 'customers', 'deleted_records_log', 'expense_budgets', 'expenses', 'inventory_counts',
  'inventory_sessions', 'notes', 'opening_balance_counters', 'product_batches', 'product_supplier_prices', 'products',
  'profiles', 'purchase_orders', 'sales', 'shop_members', 'shop_notes', 'shop_sale_counters', 'stock_movements',
  'stock_reservations', 'suppliers', 'support_contacts', 'subscriptions', 'push_subscriptions', 'admin_notifications',
  'agent_commissions', 'currency_migration_log',
]
const LINKED = new Set(['purchase_order_items', 'stock_transfers'])
const NEVER = /\/api\/sales\/(checkout|sync)|\/api\/offline/

function refuse(msg) { console.error('MODE ÉCRITURE REFUSÉ : ' + msg); process.exit(2) }

async function enableWrite({ test, routes = [] }) {
  // ── 1. Environnement : refus immédiat, avant toute connexion ─────────────────────────────────────────────────
  const base = process.env.CAPTURE_BASE
  if (!base || !LOCAL.test(base)) refuse(`${test} : serveur local obligatoire (CAPTURE_BASE = ${base || 'absent'})`)
  if (process.env.CAPTURE_PROD_READONLY) refuse(`${test} : CAPTURE_PROD_READONLY est positionné — jamais d'écriture en ligne`)
  if (!routes.length) refuse(`${test} : aucune route d'écriture déclarée`)

  const ROOT = path.resolve(__dirname, '../../..')
  const env = {}
  for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
  const db = require(path.join(ROOT, 'node_modules/@supabase/supabase-js')).createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  // ── 2. La base confirme que la cible est Boutique Alpha ─────────────────────────────────────────────────────
  const { data: shop, error } = await db.from('shops').select('id, name, owner_id, deleted_at').eq('id', ALPHA).single()
  if (error || !shop) refuse('Boutique Alpha introuvable en base')
  const owner = (await db.auth.admin.getUserById(shop.owner_id)).data.user
  if (shop.name !== ALPHA_NAME || shop.deleted_at || owner?.email !== ALPHA_OWNER) refuse(`la boutique ${ALPHA} n'est pas la boutique d'essai attendue (« ${shop.name} », ${owner?.email})`)

  const RUN = 't' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex')
  console.log(`MODE ÉCRITURE — ${test} · exécution ${RUN} · serveur local · cible vérifiée en base : « ${shop.name} » (${ALPHA})`)

  const before = await snapshot(db)
  const W = {
    RUN, ALPHA, db, routes, before, mid: null,
    // Décision pour une requête du navigateur (non GET) : autorisée seulement si route déclarée ET boutique = Alpha
    allows(request) {
      const url = request.url()
      if (NEVER.test(url)) return false
      if (!routes.some(r => r.test(url))) return false
      return shopOfRequest(request) === ALPHA
    },
    // Écriture directe (fixture) : Alpha uniquement, ligne marquée par la référence de l'exécution
    async insert(table, row) {
      if (row.shop_id !== ALPHA) refuse(`insertion directe hors Alpha (${table})`)
      const { data, error: e } = await db.from(table).insert(row).select('id').single()
      if (e) throw new Error(`insertion ${table} : ${e.message}`)
      return data.id
    },
    // Photo intermédiaire (avant une suppression par le parcours normal) : les lignes nouvelles vues ici sont comptées
    // comme créées même si le parcours normal les supprime ensuite
    seen: {},
    async checkpoint() {
      const snap = await snapshot(db)
      for (const [t, rows] of Object.entries(diffNew(W.before, snap))) { W.seen[t] ||= new Set(); rows.forEach(r => W.seen[t].add(r.id)) }
    },
    // Nettoyage : lignes NOUVELLES d'Alpha et rattachées au test (prédicat), supprimées une à une par identifiant
    async cleanup(rules) {
      W.mid = await snapshot(db)
      const created = diffNew(W.before, W.mid)
      const report = {}
      // Lignes vues à la photo intermédiaire puis supprimées par le parcours normal du test
      for (const [t, ids] of Object.entries(W.seen)) {
        const stillThere = new Set((created[t] || []).map(r => r.id))
        const goneByFlow = [...ids].filter(id => !stillThere.has(id)).length
        if (goneByFlow) report[t] = { created: goneByFlow, deleted: 0, byFlow: goneByFlow }
      }
      for (const [table, keep] of Object.entries(created)) {
        const rule = rules[table]
        // Tables liées sans shop_id : déjà restreintes à Alpha par la photo (bons d'Alpha, transferts touchant Alpha)
        const noShopCol = LINKED.has(table)
        const mine = rule ? keep.filter(r => (noShopCol || r.shop_id === ALPHA) && rule(r)) : []
        const prev = report[table] || { created: 0, deleted: 0, byFlow: 0 }
        report[table] = { created: prev.created + keep.length, deleted: prev.deleted, byFlow: prev.byFlow || 0 }
        for (const r of mine) {
          if (W.before[table]?.has(r.id)) refuse(`tentative de suppression d'une ligne préexistante (${table} ${r.id})`)
          let del = db.from(table).delete({ count: 'exact' }).eq('id', r.id)
          if (!noShopCol) del = del.eq('shop_id', ALPHA)
          const { error: e, count } = await del
          if (e) console.log(`  suppression ${table} ${r.id} : ${e.message}`)
          else report[table].deleted += count || 0
        }
      }
      return report
    },
    // Nettoyage + photo finale + rapport. Renvoie true si : rien de préexistant touché et aucune trace restante.
    async finish(rules) {
      console.log(`\nMode écriture — bilan de l'exécution ${RUN}`)
      console.log(`  écritures du navigateur autorisées : ${(W.sent || []).length}${W.sent?.length ? ' (' + [...new Set(W.sent)].join(', ') + ')' : ''}`)
      console.log(`  écritures du navigateur bloquées : ${(W.blocked || []).length}${W.blocked?.length ? ' (' + [...new Set(W.blocked)].join(', ') + ')' : ''}`)
      const rep = await W.cleanup(rules)
      let created = 0, deleted = 0
      for (const [t, x] of Object.entries(rep)) { created += x.created; deleted += x.deleted + (x.byFlow || 0); console.log(`  ${t} : ${x.created} ligne(s) créée(s)${x.byFlow ? `, ${x.byFlow} supprimée(s) par le parcours normal du test` : ''}, ${x.deleted} supprimée(s) au nettoyage`) }
      if (!Object.keys(rep).length) console.log('  aucune ligne créée')
      const v = await W.verify()
      console.log(`  lignes préexistantes supprimées : ${v.removed.length}${v.removed.length ? ' → ' + v.removed.join(' | ') : ''}`)
      console.log(`  lignes préexistantes modifiées : ${v.modified.length}${v.modified.length ? ' → ' + v.modified.join(' | ') : ''}`)
      console.log(`  traces restantes en base : ${v.remaining.length}${v.remaining.length ? ' → ' + v.remaining.join(' | ') : ''}`)
      W.summary = { created, deleted, ...v }
      return !v.removed.length && !v.modified.length && !v.remaining.length
    },
    // Photo finale : rien de préexistant touché, aucune trace restante
    async verify() {
      const after = await snapshot(db)
      const res = { removed: [], modified: [], remaining: [] }
      for (const table of Object.keys(W.before)) {
        for (const [id, h] of W.before[table]) {
          if (!after[table].has(id)) res.removed.push(`${table} ${id}`)
          else if (after[table].get(id).hash !== h.hash) res.modified.push(`${table} ${id} (${changedCols(h.row, after[table].get(id).row).join(', ')})`)
        }
        for (const [id, r] of after[table]) if (!W.before[table].has(id)) res.remaining.push(`${table} ${id} ${summary(r.row)}`)
      }
      return res
    },
  }
  return W
}

function shopOfRequest(request) {
  const url = new URL(request.url())
  const q = url.searchParams.get('shop_id')
  let b = null
  try { const j = request.postDataJSON(); b = j && typeof j === 'object' ? j.shop_id : null } catch {}
  if (q && b && q !== b) return null
  return b || q || null
}

async function snapshot(db) {
  const snap = {}
  const take = async (table, build) => {
    const rows = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await build(db.from(table).select('*')).range(from, from + 999)
      if (error) throw new Error(`photo ${table} : ${error.message}`)
      rows.push(...data); if (data.length < 1000) break
    }
    snap[table] = new Map(rows.map(r => [r.id ?? JSON.stringify(r), { hash: hash(r), row: r }]))
  }
  for (const t of SHOP_TABLES) await take(t, q => q.eq('shop_id', ALPHA))
  const poIds = [...snap.purchase_orders.keys()]
  await take('purchase_order_items', q => q.in('purchase_order_id', poIds.length ? poIds : ['00000000-0000-0000-0000-000000000000']))
  await take('stock_transfers', q => q.or(`source_shop_id.eq.${ALPHA},destination_shop_id.eq.${ALPHA}`))
  return snap
}
function hash(r) { return crypto.createHash('sha1').update(JSON.stringify(r)).digest('hex') }
function diffNew(before, after) {
  const out = {}
  for (const t of Object.keys(after)) { const n = [...after[t]].filter(([id]) => !before[t].has(id)).map(([, v]) => v.row); if (n.length) out[t] = n }
  return out
}
function changedCols(a, b) { return Object.keys({ ...a, ...b }).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])) }
function summary(r) { return JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => /name|action|source_ref|reason|type|reference|status/.test(k)))).slice(0, 160) }

module.exports = { enableWrite, ALPHA }
