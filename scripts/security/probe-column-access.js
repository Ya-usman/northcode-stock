#!/usr/bin/env node
// Sonde EN LECTURE SEULE : ce qu'un utilisateur connecté peut réellement lire
// en interrogeant la base directement (sans passer par l'application), table
// par table et colonne par colonne, pour les données de
// scripts/security/protected-data.json.
//
// À lancer avant et après chaque migration de l'étape C :
//   node scripts/security/probe-column-access.js --email=<compte de test> --expect=open|c1|c2|c3
//
//   open : rien n'est encore verrouillé dans la base (état d'avant C1) ;
//   c1   : tables d'achat (lignes de bons, prix fournisseurs, lignes de transfert) refusées ;
//   c2   : + prix d'achat des produits, des lots et des lignes de vente refusés,
//          toutes leurs AUTRES colonnes restant lisibles (sinon un écran casse) ;
//   c3   : + solde dû aux fournisseurs, bons de commande et paiements fournisseurs refusés.
//
// Elle vérifie aussi que les listes de colonnes publiques du code
// (lib/products/columns.ts, lib/suppliers/columns.ts) contiennent bien toutes
// les colonnes non protégées de leur table : une colonne ajoutée à la base
// sans y figurer — ou sans droit de lecture — est signalée.
//
// Aucune écriture. La clé de service (lue dans .env.local) ne sert qu'à lister
// les colonnes et à ouvrir une session pour le compte de test ; elle n'est
// jamais affichée.
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const RULES = require('./protected-data.json')
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || null
const email = arg('email'), expect = arg('expect') || 'open'
if (!email || !['open', 'c1', 'c2', 'c3'].includes(expect)) {
  console.error('Usage : node scripts/security/probe-column-access.js --email=<compte de test> [--expect=open|c1|c2|c3]')
  process.exit(2)
}

const env = {}
for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(path.join(ROOT, 'node_modules', '@supabase', 'supabase-js'))
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const admin = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

// Ce que chaque étape verrouille
const C1_TABLES = ['purchase_order_items', 'product_supplier_prices', 'stock_transfer_items']
const C2_COLUMNS = { products: ['buying_price'], product_batches: ['buying_price'], sale_items: ['buying_price'] }
const C3_TABLES = ['purchase_orders', 'supplier_payments'], C3_COLUMNS = { suppliers: ['total_owed'] }
const stage = { open: 0, c1: 1, c2: 2, c3: 3 }[expect]
const tableLocked = t => (stage >= 1 && C1_TABLES.includes(t)) || (stage >= 3 && C3_TABLES.includes(t))
const columnLocked = (t, c) => tableLocked(t) || (stage >= 2 && (C2_COLUMNS[t] || []).includes(c)) || (stage >= 3 && (C3_COLUMNS[t] || []).includes(c))

const publicList = (file, name) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const block = src.slice(src.indexOf(`export const ${name}`))
  return [...block.slice(0, block.indexOf('\n\n') > 0 ? block.indexOf('\n\n') : 600).matchAll(/'([^']+)'/g)].flatMap(m => m[1].split(',').map(x => x.trim())).filter(x => /^[a-z_]+$/.test(x))
}
const CODE_LISTS = { products: publicList('lib/products/columns.ts', 'PRODUCT_PUBLIC_COLUMNS'), suppliers: publicList('lib/suppliers/columns.ts', 'SUPPLIER_PUBLIC_COLUMNS') }

;(async () => {
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr) throw new Error('compte de test introuvable : ' + linkErr.message)
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
  const { data: otp, error: otpErr } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (otpErr) throw new Error('session impossible : ' + otpErr.message)
  const headers = { apikey: ANON, Authorization: `Bearer ${otp.session.access_token}` }
  const read = async (table, select) => (await fetch(`${URL_}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`, { headers })).status

  console.log(`Sonde d'accès direct à la base — compte ${email} — état attendu : ${expect}\n`)
  const problems = []
  const tables = [...Object.keys(RULES.protectedColumns), ...RULES.serverOnlyTables]
  for (const table of tables) {
    const { data: sample, error } = await admin.from(table).select('*').limit(1)
    if (error) { problems.push(`${table} : colonnes illisibles par le rôle de service (${error.message})`); continue }
    const columns = sample && sample[0] ? Object.keys(sample[0]) : null
    if (!columns) { console.log(`  ${table.padEnd(26)} table vide : colonnes non listées (sonde limitée à « * »)`) }
    const star = await read(table, '*')
    const sensitive = RULES.protectedColumns[table] || []
    const readable = [], refused = []
    for (const c of columns || []) ((await read(table, c)) === 200 ? readable : refused).push(c)
    const starOk = star === 200
    console.log(`  ${table.padEnd(26)} « * » : ${starOk ? 'lisible' : 'refusée (' + star + ')'} · ${readable.length} colonne(s) lisible(s)${refused.length ? ' · refusée(s) : ' + refused.join(', ') : ''}`)
    // Attendu
    const anyLocked = tableLocked(table) || sensitive.some(c => columnLocked(table, c))
    if (starOk === anyLocked) problems.push(`${table} : « * » ${starOk ? 'lisible' : 'refusée'}, attendu ${anyLocked ? 'refusée' : 'lisible'} à l'état ${expect}`)
    for (const c of columns || []) {
      const locked = columnLocked(table, c), isReadable = readable.includes(c)
      if (locked && isReadable) problems.push(`${table}.${c} : encore lisible directement (attendu : refusée à l'état ${expect})`)
      if (!locked && !isReadable) problems.push(`${table}.${c} : refusée alors qu'elle doit rester lisible — un écran qui la lit casserait (droit de lecture manquant)`)
    }
    // Listes publiques du code : toute colonne non protégée doit y être, aucune colonne protégée ne doit y être
    if (CODE_LISTS[table] && columns) {
      const missing = columns.filter(c => !sensitive.includes(c) && !CODE_LISTS[table].includes(c))
      const leaked = CODE_LISTS[table].filter(c => sensitive.includes(c)), unknown = CODE_LISTS[table].filter(c => !columns.includes(c))
      if (missing.length) problems.push(`${table} : colonne(s) de la base absente(s) de la liste publique du code : ${missing.join(', ')}`)
      if (leaked.length) problems.push(`${table} : colonne(s) protégée(s) dans la liste publique du code : ${leaked.join(', ')}`)
      if (unknown.length) problems.push(`${table} : la liste publique du code nomme une colonne qui n'existe pas : ${unknown.join(', ')}`)
    }
  }
  if (problems.length) { console.error(`\n✗ ${problems.length} écart(s) :\n` + problems.map(p => '  - ' + p).join('\n') + '\n'); process.exit(1) }
  console.log(`\n✓ conforme à l'état « ${expect} »`)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
