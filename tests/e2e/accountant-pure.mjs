// Lot Rôles, partie B (6 nov. 2026) : rôle Comptable (accountant), en lecture seule comme l'Observateur.
// Test PUR, sans base ni serveur : règle unique (lib/permissions), hiérarchie (lib/team/roles), navigation, textes.
// Usage : node tests/e2e/accountant-pure.mjs
import { readFileSync } from 'node:fs'
const P = await import(new URL('../../lib/permissions/index.ts', import.meta.url).href)
const R = await import(new URL('../../lib/team/roles.ts', import.meta.url).href)
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m + (!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : '')) }
const feats = [...P.LEVEL_FEATURES, ...P.SWITCH_FEATURES, ...P.WIDGET_FEATURES]

console.log('1. Règle unique : lecture seule commune')
ok(JSON.stringify([...P.READ_ONLY_ROLES].sort()) === '["accountant","viewer"]', 'rôles en lecture seule : Observateur et Comptable')
ok(P.isReadOnlyRole('accountant') && P.isReadOnlyRole('viewer') && !P.isReadOnlyRole('manager') && !P.isReadOnlyRole(null), 'isReadOnlyRole')
ok(P.CONFIGURABLE_ROLES.includes('accountant'), 'Comptable réglable dans Accès par rôle')
// Aucune modification, même si le réglage de la boutique essaie de l'ouvrir
const forced = { accountant: Object.fromEntries([...feats, ...P.LEVEL_FEATURES.map(P.writeKey)].map(k => [k, true])) }
for (const stored of [null, forced]) {
  const writes = feats.filter(f => P.resolvePermission(stored, 'accountant', f).write && !P.READ_ONLY_LOCKED.includes(f) && P.isLevelFeature(f))
  ok(writes.length === 0, `${stored ? 'réglage forcé à « oui »' : 'par défaut'} : aucune page en modification`, writes)
  const actions = P.READ_ONLY_LOCKED.filter(f => P.resolvePermission(stored, 'accountant', f).view)
  ok(actions.length === 0, `${stored ? 'réglage forcé à « oui »' : 'par défaut'} : aucune action d'écriture (vente, remise, caisse, inventaire…)`, actions)
}
// Les interrupteurs non verrouillés renvoient write = view : seuls des droits de lecture peuvent y figurer
ok(P.SWITCH_FEATURES.filter(f => !P.READ_ONLY_LOCKED.includes(f)).every(f => ['reports', 'expiry_list', 'revenue_chart', 'notes', 'view_purchase_cost'].includes(f)),
  'interrupteurs ouvrables : uniquement des lectures (rapports, péremptions, chiffre, notes, prix d\'achat)')

console.log('\n2. Ce que voit le Comptable par défaut')
const sees = ['sales_history', 'payments', 'customers', 'expenses', 'reports', 'suppliers', 'stock', 'movements', 'transfers', 'categories', 'expiry_list']
ok(sees.every(f => P.canView(null, 'accountant', f)), 'ventes, crédits, clients, dépenses, rapports, fournisseurs, stock', sees.filter(f => !P.canView(null, 'accountant', f)))
ok(P.canViewCost(null, 'accountant'), 'prix d\'achat et marges : oui par défaut')
ok(!P.canViewCost({ accountant: { view_purchase_cost: false } }, 'accountant'), 'prix d\'achat : le propriétaire peut le retirer')
ok(['new_sale', 'caisse', 'inventory_count', 'notes', 'discount'].every(f => !P.canView(null, 'accountant', f)), 'ni vente, ni caisse, ni inventaire, ni notes')
ok(['widget_today_revenue', 'widget_outstanding_debt', 'widget_net_result', 'widget_rep_marge_brute'].every(f => P.canView(null, 'accountant', f)), 'tableau de bord et rapports : encaissé, crédits, résultat, marge')
ok(!P.canView({ general: { reports: false } }, 'accountant', 'reports'), 'onglet « Général » respecté')
ok(P.canView(null, 'accountant', 'revenue_chart') && !P.canView({ accountant: { revenue_chart: false } }, 'accountant', 'revenue_chart'),
  'chiffre d\'affaires de la boutique (encaissements du mois, graphique) : oui par défaut, retirable (215)')
ok(['manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer'].every(r => !P.canView(null, r, 'revenue_chart')), 'autres rôles : chiffre de la boutique inchangé (non par défaut)')
ok(!P.isManagerial('accountant'), 'aucune action de direction (annuler un paiement, passer une dette en perte…)')

console.log('\n3. Observateur inchangé')
const vForced = { viewer: forced.accountant }
ok(P.LEVEL_FEATURES.every(f => !P.resolvePermission(vForced, 'viewer', f).write) && P.READ_ONLY_LOCKED.every(f => !P.resolvePermission(vForced, 'viewer', f).view),
  'Observateur : toujours aucune modification ni action d\'écriture, même réglage forcé')
ok(!P.canView(null, 'viewer', 'expenses') && !P.canViewCost(null, 'viewer'), 'Observateur : ni dépenses ni prix d\'achat par défaut')
const lvl = P.levelOf(P.mergeRolePerms('accountant', { accountant: { expenses: true, expenses_write: true } }), 'accountant', 'expenses')
ok(lvl === 'read', 'Paramètres : niveau affiché « lecture » même si « modification » est enregistrée', lvl)

console.log('\n4. Équipe : qui attribue le rôle')
ok(R.ASSIGNABLE_ROLES.includes('accountant') && R.ROLE_ORDER.includes('accountant'), 'rôle attribuable et classé')
ok(R.canManageRole('owner', 'accountant') && R.canManageRole('shop_manager', 'accountant'), 'propriétaire et Administrateur : oui')
ok(!R.canManageRole('manager', 'accountant'), 'Responsable de boutique : non (rôle financier)')
ok(!R.manageableRoles('accountant').length && !R.isTeamManager('accountant'), 'le Comptable ne gère personne')

console.log('\n5. Navigation, base et textes')
for (const f of ['components/layout/sidebar.tsx', 'components/layout/bottom-nav.tsx']) {
  const s = read(f)
  ok(/ALL_NON_OWNER = \[[^\]]*'accountant'/.test(s) && /dashboard`,[^\n]*'accountant'/.test(s), `${f.split('/').pop()} : menus ouverts au Comptable (selon ses droits)`)
  ok(!/caisse`,[^\n]*'accountant'/.test(s) && !/team`,[^\n]*'accountant'/.test(s) && !/settings`,[^\n]*'accountant'/.test(s), `${f.split('/').pop()} : ni caisse, ni équipe, ni réglages`)
}
ok(/'accountant'/.test(read('lib/types/database.ts')), 'type UserRole')
const sql = read('supabase/migrations/214_accountant_role.sql')
ok(/shop_members_role_check[\s\S]*'accountant'/.test(sql) && /profiles_role_check[\s\S]*'accountant'/.test(sql), 'migration 214 : rôles autorisés')
ok(/sales_read_all[\s\S]*'viewer', 'accountant'\]/.test(sql) && /sale_in_history/.test(sql), 'migration 214 : ventes de toute la boutique, durée d\'historique gardée')
const dash = read('components/dashboard/metric-cards.tsx')
ok(/role === 'viewer' \? '—'/.test(dash), 'tableau de bord : seuls les montants de l\'Observateur sont masqués (le Comptable les voit)')
for (const l of ['fr', 'en', 'ha']) {
  const m = JSON.parse(read(`messages/${l}.json`))
  ok(m.roles.accountant && m.roles_desc.accountant?.length > 30 && m.settings.perm_accountant_readonly?.length > 30, `${l} : nom, phrase et note « lecture seule » (${m.roles.accountant})`)
  ok(!/[—–]|\(s\)/.test(m.roles_desc.accountant + m.settings.perm_accountant_readonly), `${l} : ni tiret long ni « (s) »`)
}
const fr = JSON.parse(read('messages/fr.json'))
ok(fr.roles.accountant === 'Comptable', 'fr : « Comptable »')
for (const l of ['fr', 'en', 'ha']) {
  const w = JSON.parse(read(`messages/${l}.json`)).onboarding.welcome.body
  ok(w.read_only && !/caisse|till|asusu/i.test(w.read_only), `${l} : accueil des rôles en lecture seule sans la caisse`, w.read_only)
}
ok(/isReadOnlyRole\(role\) \? 'read_only'/.test(read('components/onboarding/team-welcome.tsx')), 'carte d\'accueil : texte « lecture seule » pour l\'Observateur et le Comptable')

console.log('\n6. Visite express et tableau de bord')
const TO = await import(new URL('../../lib/onboarding/tours.ts', import.meta.url).href)
const ids = list => TO.tourSteps('quick_tour', list).map(s => s.id)
ok(!ids(['quick_tour']).includes('sell') && ids(['quick_tour']).length === TO.TOURS.quick_tour.length - 1, 'sans droit de vendre : pas d\'étape « Vendre »', ids(['quick_tour']))
ok(ids(['quick_tour', 'first_sale']).includes('sell'), 'avec le droit de vendre : étape « Vendre » gardée')
const prov = read('components/onboarding/onboarding-provider.tsx')
ok(/available\.includes\(s\.next\)/.test(prov) && /'body_alone'/.test(prov), 'fin de visite : suite proposée seulement si accessible, sinon texte sans suite')
for (const l of ['fr', 'en', 'ha']) {
  const tt = JSON.parse(read(`messages/${l}.json`)).onboarding.tours
  ok(tt.quick_tour.done.body_alone && tt.add_product.done.body_alone && tt.add_product.done.body_alone.length < tt.add_product.done.body.length, `${l} : fins sans suite (visite express, ajout de produit)`)
}
ok(/canAccess\('widget_net_result'\) && !isReadOnlyRole\(role\)/.test(read('components/dashboard/metric-cards.tsx')), 'tableau de bord : « Mes encaissements du mois » masqué aux rôles en lecture seule')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
