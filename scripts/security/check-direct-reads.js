#!/usr/bin/env node
// Contrôle automatique (sans base, sans réseau) : le code exécuté dans le
// NAVIGATEUR ne lit jamais directement une donnée protégée.
//
//   - colonne protégée (prix d'achat, solde dû à un fournisseur) : interdit de
//     la nommer dans un `select`, et interdit de lire sa table avec « * » ou
//     sans liste de colonnes — la base refusera ces lectures (étapes C1 à C3),
//     et une colonne ajoutée par mégarde à une liste casserait l'écran ;
//   - table réservée au serveur (bons de commande, paiements fournisseurs,
//     prix fournisseurs, lignes de transfert) : interdit de la lire, seule ou
//     imbriquée dans une autre lecture.
//
// Ces données passent par des routes serveur, qui appliquent les droits
// (lib/permissions → canViewCost ; lib/api/supplier-access → dettes).
// La liste est dans scripts/security/protected-data.json.
//
// Usage : node scripts/security/check-direct-reads.js   (lancé avant chaque construction : npm run build)
const fs = require('fs')
const path = require('path')

// CHECK_DIRECT_READS_ROOT : dossier d'essai (tests du contrôle lui-même) — sinon le dépôt
const ROOT = process.env.CHECK_DIRECT_READS_ROOT ? path.resolve(process.env.CHECK_DIRECT_READS_ROOT) : path.resolve(__dirname, '..', '..')
const RULES = require('./protected-data.json')
const PROTECTED = RULES.protectedColumns
const SERVER_ONLY = RULES.serverOnlyTables
const ALL_COLUMNS = [...new Set(Object.values(PROTECTED).flat())]

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) out.push(full)
  }
  return out
}

/** Un fichier est « serveur » s'il vit dans un dossier serveur, s'il crée un client serveur, ou s'il est listé avec sa raison. */
function isServerFile(rel, source) {
  if (RULES.serverPathPrefixes.some(p => rel.startsWith(p))) return true
  if (rel in RULES.serverFiles) return true
  if (/from ['"]@\/lib\/supabase\/server['"]|createAdminClient\(|import ['"]server-only['"]/.test(source)) return true
  return false
}

/** Premier argument d'un appel dont la parenthèse ouvrante est à `open` (texte brut, parenthèses équilibrées). */
function firstArgument(source, open) {
  let depth = 0, quote = null
  for (let i = open; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return source.slice(open + 1, i) }
    else if (c === ',' && depth === 1) return source.slice(open + 1, i)
  }
  return source.slice(open + 1)
}
const lineOf = (source, index) => source.slice(0, index).split('\n').length

const violations = []
const files = RULES.sourceRoots.flatMap(r => walk(path.join(ROOT, r)))
let browserFiles = 0
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  const source = fs.readFileSync(file, 'utf8')
  if (isServerFile(rel, source)) continue
  browserFiles++
  const report = (index, message) => violations.push(`${rel}:${lineOf(source, index)}  ${message}`)

  // 1. Lectures directes : .from('table') — ou nom CALCULÉ (.from(x ? 'customers' : 'suppliers')) : chaque table
  //    protégée citée dans l'argument compte — puis son .select(...)
  for (const m of source.matchAll(/\.from\(/g)) {
   const fromArg = firstArgument(source, m.index + m[0].length - 1).trim()
   const literal = fromArg.match(/^['"`]([a-z_]+)['"`]$/)
   const named = literal ? [literal[1]] : [...fromArg.matchAll(/['"`]([a-z_]+)['"`]/g)].map(x => x[1])
   for (const table of new Set(named)) {
    if (SERVER_ONLY.includes(table)) { report(m.index, `table « ${table} » réservée au serveur${literal ? '' : ' (nom calculé)'}`); continue }
    if (!(table in PROTECTED)) continue
    // La lecture s'arrête à la prochaine table ou à la fin de l'instruction
    const rest = source.slice(m.index + m[0].length)
    const stop = rest.search(/\.from\(|\n\s*\n/)
    const chain = stop < 0 ? rest.slice(0, 600) : rest.slice(0, Math.min(stop, 600))
    const sel = chain.match(/\.select\(/)
    if (!sel) continue
    const arg = firstArgument(chain, sel.index + sel[0].length - 1).trim()
    if (arg === '') report(m.index, `« ${table} » lue sans liste de colonnes (toutes les colonnes, dont ${PROTECTED[table].join(', ')})`)
    else if (/(^|[\s'"`,])\*/.test(arg.replace(/\$\{[^}]*\}/g, ''))) report(m.index, `« ${table} » lue avec « * » (dont ${PROTECTED[table].join(', ')})`)
    else if (!/['"`]/.test(arg) && !/PUBLIC_COLUMNS/.test(arg)) report(m.index, `« ${table} » : liste de colonnes non vérifiable (${arg.slice(0, 40)}) — utiliser une constante …_PUBLIC_COLUMNS`)
    for (const col of PROTECTED[table]) if (new RegExp(`\\b${col}\\b`).test(arg)) report(m.index, `colonne protégée « ${table}.${col} » lue par le navigateur`)
   }
  }

  // 2. Lectures imbriquées et colonnes protégées nommées dans n'importe quel select
  for (const m of source.matchAll(/\.select\(/g)) {
    const arg = firstArgument(source, m.index + m[0].length - 1)
    // Indice de clé étrangère quelconque (!inner, !left, !nom_de_cle) ; « * » où qu'elle soit dans la sous-sélection
    for (const table of SERVER_ONLY) if (new RegExp(`\\b${table}\\s*(![a-z_]+)?\\s*\\(`).test(arg)) report(m.index, `table « ${table} » (réservée au serveur) imbriquée dans une lecture`)
    for (const table of Object.keys(PROTECTED)) if (new RegExp(`\\b${table}\\s*(![a-z_]+)?\\s*\\([^()]*\\*`).test(arg)) report(m.index, `« ${table}(*) » imbriquée (dont ${PROTECTED[table].join(', ')})`)
    for (const col of ALL_COLUMNS) if (new RegExp(`['"\`,\\s(]${col}\\b`).test(arg)) report(m.index, `colonne protégée « ${col} » nommée dans une lecture du navigateur`)
  }
}

const unique = [...new Set(violations)]
if (unique.length) {
  console.error(`\n✗ ${unique.length} lecture(s) directe(s) d'une donnée protégée dans le code du navigateur :\n`)
  for (const v of unique) console.error('  ' + v)
  console.error('\nCes données doivent passer par une route serveur (voir scripts/security/protected-data.json).\n')
  process.exit(1)
}
console.log(`✓ données protégées : aucune lecture directe dans les ${browserFiles} fichiers exécutés par le navigateur (${Object.keys(PROTECTED).length} tables à colonne protégée, ${SERVER_ONLY.length} tables réservées au serveur)`)
