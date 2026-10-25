// Banc de la 184 : écrit sur la sortie standard les cas de comparaison « règle SQL ↔ application », au format COPY
// (réglage JSON, rôle, fonction, attendu). Attendu = resolvePermission(...).view de lib/permissions, sauf la décision 1
// du 25 oct. 2026 (propriétaire : toujours « oui » dans la base).
// Usage : node supabase/drafts/184_rule_cases.mjs [réglages-réels.json]
import { readFileSync } from 'node:fs'
const P = await import(new URL('../../lib/permissions/index.ts', import.meta.url).href)
const feats = [...P.LEVEL_FEATURES, ...P.SWITCH_FEATURES, ...P.WIDGET_FEATURES, 'fonction_inconnue']
const roles = ['owner', 'super_admin', ...P.CONFIGURABLE_ROLES, 'inconnu']
const synthetic = [
  null, {},
  { general: { expenses: false, stock: false, new_sale: false } },
  { general: { view_purchase_cost: false } },
  { general: { fonction_inconnue: true }, manager: { fonction_inconnue: true } },
  { general: {}, cashier: { expenses: true, stock: true, caisse: true, reports: true } },
  { viewer: { new_sale: true, caisse: true, expenses: true, discount: true, notes: true } },
  { stock_manager: { sales_history: true, expenses: false, customers: true }, general: { movements: false } },
  { manager: { expenses: false, notes: false, sales_history: false }, shop_manager: { expenses: false } },
  // valeurs anciennes / inattendues : vérité comme « !! » en JavaScript
  { cashier: { expenses: 1, stock: '', movements: 'x', categories: null, suppliers: 0, reports: [], notes: {} },
    general: { transfers: 0, customers: 'non', payments: null } },
  { viewer: { stock: false, customers: false }, cashier: { new_sale: false, customers: false } },
]
const real = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], 'utf8')) : []
const esc = s => s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n')
for (const stored of [...synthetic, ...real]) {
  for (const role of roles) for (const f of feats) {
    const want = role === 'owner' ? true : !!P.resolvePermission(stored, role, f).view
    process.stdout.write(`${stored === null ? '\\N' : esc(JSON.stringify(stored))}\t${role}\t${f}\t${want}\n`)
  }
}
process.stderr.write(`${synthetic.length} réglages construits + ${real.length} réglages réels, ${roles.length} rôles, ${feats.length} fonctions\n`)
