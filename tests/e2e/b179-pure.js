// 179 « traitement des lots périmés » — tests PURS, sans base ni serveur : contrôle du texte de la migration
// (brouillon tant qu'elle n'est pas appliquée) et modèle de référence des règles (retrait d'un motif de
// review_reason, lot candidat, résolution sans double déduction). Les fonctions SQL elles-mêmes sont
// exécutées par la répétition transactionnelle puis par les tests sur Boutique Alpha.
// Usage : node tests/e2e/b179-pure.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ROOT = path.resolve(__dirname, '../..')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }

const pick = name => [ROOT + '/supabase/migrations/' + name, ROOT + '/supabase/drafts/' + name].find(f => fs.existsSync(f))
const sql = fs.readFileSync(pick('179_batch_treatments.sql'), 'utf8').replace(/\r/g, '')
const rb = fs.readFileSync(pick('179_batch_treatments_rollback.sql'), 'utf8').replace(/\r/g, '')
const code = sql.replace(/--[^\n]*/g, '')   // texte SQL sans commentaires
const fn = name => { const m = code.match(new RegExp(`FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$`)); return m ? m[1] : '' }
const pos = (s, re) => { const m = s.search(re); return m < 0 ? Infinity : m }

console.log('\n1. Instructions transactionnelles, droits')
ok(!/CONCURRENTLY|VACUUM|ADD VALUE|^\s*(BEGIN|COMMIT)\s*;/im.test(code + rb), 'aucune instruction non transactionnelle (migration et retour arrière)')
const created = [...code.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(/g)].map(m => m[1])
const revoked = new Set([...code.matchAll(/REVOKE EXECUTE ON FUNCTION public\.(\w+)\([^)]*\)\s+FROM PUBLIC, anon, authenticated/g)].map(m => m[1]))
ok(created.length >= 10 && created.every(f => revoked.has(f)), `les ${created.length} fonctions créées sont retirées à anon / authenticated`)
ok(/REVOKE EXECUTE ON FUNCTION public\.adjust_batch_quantity\([^)]*\) FROM PUBLIC, anon, authenticated, service_role/.test(code),
  'adjust_batch_quantity retirée au serveur (un seul chemin de correction de quantité)')
ok(/REVOKE ALL ON TABLE public\.batch_treatments, public\.batch_treatment_photos FROM PUBLIC, anon, authenticated, service_role;\s*GRANT SELECT ON TABLE public\.batch_treatments, public\.batch_treatment_photos TO service_role;/.test(code),
  'tables : aucun droit d’écriture direct, le serveur lit seulement (écriture par les fonctions)')
ok(/INSERT INTO storage\.buckets[^;]*'batch-treatment-photos'[^;]*false, 2097152/.test(code) && !/CREATE POLICY/i.test(code),
  'espace batch-treatment-photos privé, 2 Mo, aucune politique d’accès direct')

console.log('\n2. Codes d’erreur')
const codes179 = [...new Set([...code.matchAll(/P00\d\d/g)].map(m => m[0]))].sort()
ok(codes179.every(c => /^P004\d$/.test(c)), `codes de la 179 : ${codes179.join(', ')} (tous dans P0040–P0049)`)
const others = []
// Fichiers de la 179 elle-même (correspondance code → message, routes enveloppes) : seule autre utilisation permise
const OWN_179 = /(179_batch_treatments|lib[\\/]api[\\/]batch-treatments\.ts|app[\\/]api[\\/]stock[\\/]batch-treatments|app[\\/]api[\\/]product-batches[\\/](adjust|expiry)[\\/]route\.ts|components[\\/]stock[\\/]batch-)/
const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name)
  if (e.isDirectory()) { if (!['node_modules', '.next', '.git', 'out', 'drafts'].includes(e.name)) walk(p) }
  else if (/\.(ts|tsx|sql)$/.test(e.name) && !OWN_179.test(p)) {
    const hits = fs.readFileSync(p, 'utf8').match(/P004\d/g); if (hits) others.push(`${path.relative(ROOT, p)}: ${hits.join(',')}`) } } }
for (const d of ['app', 'lib', 'components', 'supabase/migrations']) walk(path.join(ROOT, d))
ok(others.length === 0, `aucun code P0040–P0049 utilisé ailleurs que par la 179 et son code applicatif${others.length ? ' — ' + others.join(' ; ') : ''}`)

console.log('\n3. Lot candidat : une seule définition (D2, bandeau, résolution)')
const cand = fn('unallocated_candidates')
ok(/s\.sale_status = 'active'/.test(cand) && /s\.created_at >= b\.created_at/.test(cand) && /batch_unallocated > 0/.test(cand)
  && /si\.product_id = b\.product_id/.test(cand) && /s\.shop_id = b\.shop_id/.test(cand) && /b\.quantity > 0/.test(cand),
  'unallocated_candidates : même boutique, même produit, vente active, non attribué > 0, lot enregistré avant la vente, lot non vide')
ok((code.match(/created_at >= b\.created_at|created_at <= s\.created_at|created_at > v_sale\.created_at/g) || []).length === 1,
  'la condition d’antériorité du lot n’existe qu’à un seul endroit')
const tb = fn('treat_batch'), ru = fn('resolve_unallocated')
ok(!/pending_unallocated_qty/.test(code) && (tb.match(/unallocated_candidates\(p_batch_id\)/g) || []).length >= 2,
  'D2 dans treat_batch : blocage par « CE lot est candidat », plus par « le produit a du non attribué »')
ok(/v_delta < 0 AND v_expired AND EXISTS \(SELECT 1 FROM unallocated_candidates\(p_batch_id\)\)/.test(tb),
  'D2 : ajustement bloqué seulement s’il DIMINUE un lot périmé candidat (augmentation, date : autorisées)')
ok(/unallocated_candidates\(p_batch_id\) c WHERE c\.sale_id = p_sale_id/.test(ru), 'resolve_unallocated utilise la même définition')

console.log('\n4. Résolution : aucune double déduction')
ok(!/UPDATE products/.test(ru) && !/INSERT INTO stock_movements/.test(ru), 'resolve_unallocated ne modifie jamais products.quantity et ne crée aucun mouvement')
ok(/v_prod_qty, v_prod_qty,/.test(ru), 'événement de résolution : product_qty_before = product_qty_after')
ok(/action = 'unallocated_resolution' AND quantity > 0\s+AND lot_qty_after = lot_qty_before - quantity AND product_qty_after = product_qty_before/.test(code),
  'contrainte : une résolution ne peut pas décrire un changement du stock produit')
const order = [/FROM sales WHERE id = p_sale_id AND shop_id = p_shop_id FOR UPDATE/, /FROM sale_items\s+WHERE sale_id = p_sale_id AND product_id = p_product_id ORDER BY id FOR UPDATE/,
  /FROM products WHERE id = p_product_id AND shop_id = p_shop_id FOR UPDATE/, /FROM product_batches\s+WHERE id = p_batch_id AND shop_id = p_shop_id AND product_id = p_product_id FOR UPDATE/].map(r => pos(ru, r))
ok(order.every((p, i) => p < Infinity && (i === 0 || p > order[i - 1])), 'verrous de la résolution : vente → lignes (ordre id) → produit → lot')
const tOrder = [pos(tb, /FROM products WHERE id = v_product_id AND shop_id = p_shop_id FOR UPDATE/), pos(tb, /FROM product_batches WHERE id = p_batch_id AND shop_id = p_shop_id FOR UPDATE/)]
ok(tOrder[0] < tOrder[1] && tOrder[1] < Infinity, 'verrous du traitement : produit → lot (ordre des ventes)')
ok(pos(ru, /unallocated_insufficient/) < pos(ru, /batch_not_resolvable' USING ERRCODE = 'P0047',\s+DETAIL = json_build_object\('what', 'candidate'/),
  'résolution concurrente : la 2e obtient P0048 (plus assez d’unités) avant tout autre contrôle')

console.log('\n5. Idempotence')
for (const [name, body] of [['treat_batch', tb], ['resolve_unallocated', ru]]) {
  const checks = (body.match(/FROM batch_treatments WHERE shop_id = p_shop_id AND request_id = p_request_id/g) || []).length
  const firstLock = pos(body, /FOR UPDATE/)
  ok(checks === 2 && pos(body, /request_id = p_request_id/) < firstLock && /request_id_conflict' USING ERRCODE = 'P0041'/.test(body),
    `${name} : pré-contrôle sans verrou + contrôle définitif après verrous, conflit → P0041`)
}
ok(/UNIQUE \(shop_id, request_id\)/.test(code), 'unicité (boutique, request_id) en base : autorité finale')

console.log('\n6. Dates (NULL compris), corrections, immuabilité')
ok(/WHEN action = 'date_correction' THEN old_expiry_date IS DISTINCT FROM new_expiry_date/.test(code) && !/old_expiry_date <> new_expiry_date/.test(code),
  'contrainte de date : IS DISTINCT FROM (date → NULL et NULL → date acceptés, NULL → NULL refusé)')
ok(/p_new_expiry_date IS NOT DISTINCT FROM v_lot\.expiry_date/.test(tb), 'treat_batch refuse une date inchangée, NULL compris')
ok(/CHECK \(corrects_treatment_id IS DISTINCT FROM id\)/.test(code) && /corrected_treatment_mismatch/.test(fn('batch_treatments_insert_guard'))
  && /shop_id = NEW\.shop_id AND batch_id = NEW\.batch_id/.test(fn('batch_treatments_insert_guard')),
  'correction : jamais soi-même ; événement cible existant, même boutique, même lot')
ok(/BEFORE UPDATE OR DELETE ON public\.batch_treatments/.test(code) && /BEFORE UPDATE OR DELETE ON public\.batch_treatment_photos/.test(code),
  'gardes d’immuabilité sur les traitements et les photos')
const ph = fn('batch_treatment_photos_immutable')
ok(/storage\.objects WHERE bucket_id = 'batch-treatment-photos' AND name = OLD\.storage_path/.test(ph) && /SECURITY DEFINER/.test(code.split('batch_treatment_photos_immutable()')[1] || ''),
  'référence de photo supprimable seulement si son fichier a déjà quitté l’espace de stockage')
ok(/v_n >= 3/.test(fn('batch_treatment_photos_insert_guard')) && /FOR UPDATE/.test(fn('batch_treatment_photos_insert_guard')),
  '3 photos au plus, contrôle sous verrou du traitement (envois simultanés)')
ok(/now\(\) > v_t\.created_at \+ interval '30 minutes'/.test(fn('register_batch_treatment_photo')) && /v_t\.performed_by <> p_uploaded_by/.test(fn('register_batch_treatment_photo')),
  'photo : auteur du traitement, 30 minutes, heure du serveur')

console.log('\n7. Protection des lots ayant un historique')
ok(/sale_item_batches_batch_id_fkey\s+FOREIGN KEY \(batch_id\) REFERENCES public\.product_batches\(id\) ON DELETE NO ACTION/.test(code),
  'lot vendu : suppression refusée par la base (allocation en NO ACTION)')
ok(/batch_id\s+uuid NOT NULL REFERENCES public\.product_batches\(id\) ON DELETE NO ACTION/.test(code) && /ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public\.product_batches\(id\) ON DELETE NO ACTION/.test(code),
  'lot traité ou lié à un mouvement : suppression refusée par la base')
ok(/batch_has_history/.test(fn('delete_product_batch')), 'delete_product_batch : erreur lisible si historique')

console.log('\n8. Retour arrière')
ok(/n_t > 0 OR n_p > 0 OR n_m > 0 OR n_o > 0/.test(rb) && /batch_id IS NOT NULL OR batch_treatment_id IS NOT NULL/.test(rb) && /bucket_id = 'batch-treatment-photos'/.test(rb),
  'refusé dès qu’existe un traitement, une photo, un mouvement lié ou un fichier')
const rbBody = rb.match(/FUNCTION public\.delete_product_batch\([\s\S]*?AS \$\$([\s\S]*?)\$\$/)
ok(rbBody && crypto.createHash('md5').update(rbBody[1]).digest('hex') === '8ad155aae3901f1125b1ace5e138a0dd',
  'delete_product_batch remis à l’identique de la production (empreinte 8ad155aa…)')
ok(/FOREIGN KEY \(batch_id\) REFERENCES public\.product_batches\(id\) ON DELETE SET NULL/.test(rb) && /GRANT EXECUTE ON FUNCTION public\.adjust_batch_quantity/.test(rb),
  'allocation remise en SET NULL, adjust_batch_quantity rendue au serveur')

console.log('\n9. Modèle de référence : retrait d’un motif de review_reason (même algorithme que remove_review_reason)')
const removeReason = (s, c) => { const t = String(s ?? '').split(',').map(x => x.trim()).filter(x => x !== '' && x !== c.trim()); return t.length ? t.join(',') : null }
const E = 'expired_stock_unresolved'
for (const [input, want, label] of [
  [E, null, 'A — seul motif → NULL'], [`${E},other`, 'other', 'B'], [`other,${E}`, 'other', 'C'], [`a,${E},b`, 'a,b', 'D'],
  [` a , ${E} ,b `, 'a,b', 'E — espaces'], ['stock_shortfall,other', 'stock_shortfall,other', 'F — autres motifs intacts'],
  [`not_${E},${E}x`, `not_${E},${E}x`, 'sous-chaîne jamais retirée'], [`a,,${E},`, 'a', 'virgules vides normalisées'], [null, null, 'NULL → NULL']]) {
  const got = removeReason(input, E)
  ok(got === want, `${label} : ${JSON.stringify(input)} → ${JSON.stringify(got)}`)
}
const rr = fn('remove_review_reason')
ok(/string_to_array/.test(rr) && /btrim\(u\.x\)/.test(rr) && /WITH ORDINALITY/.test(rr) && /t\.token <> ''/.test(rr) && /t\.token <> btrim\(p_code\)/.test(rr) && !/replace\(/i.test(rr),
  'SQL : découpage, espaces retirés, ordre conservé, égalité exacte, aucun REPLACE')
ok(!/reviewed_at/.test(ru), 'la résolution ne touche jamais reviewed_at')

console.log('\n10. Modèle de référence : lot candidat et exemple 8 / 10 / 2')
const isCandidate = (lot, sale) => sale.status === 'active' && sale.unallocated > 0 && lot.shop === sale.shop && lot.product === sale.product
  && lot.created_at <= sale.created_at && lot.quantity > 0
const sale = { shop: 'S', product: 'P', status: 'active', unallocated: 2, created_at: '2026-10-01T10:00:00Z' }
ok(isCandidate({ shop: 'S', product: 'P', quantity: 10, created_at: '2026-09-15T08:00:00Z' }, sale), 'lot A créé le 15/09, vente du 01/10 non résolue → candidat (D2 bloque sa diminution)')
ok(!isCandidate({ shop: 'S', product: 'P', quantity: 10, created_at: '2026-10-15T08:00:00Z' }, sale), 'lot B créé le 15/10 → pas candidat (sa destruction n’est pas bloquée)')
ok(!isCandidate({ shop: 'S', product: 'P', quantity: 10, created_at: '2026-09-15T08:00:00Z' }, { ...sale, status: 'cancelled' }), 'vente annulée → ne bloque rien')
ok(!isCandidate({ shop: 'T', product: 'P', quantity: 10, created_at: '2026-09-15T08:00:00Z' }, sale), 'autre boutique → pas candidat')
let state = { product: 10, lot: 10, unal: 0 }
state = { product: state.product - 2, lot: state.lot, unal: 2 }           // vente hors ligne : 2 sorties, lot périmé exclu
const resolve = (s, n) => ({ product: s.product, lot: s.lot - n, unal: s.unal - n })
state = resolve(state, 2)
ok(state.product === 8 && state.lot === 8 && state.unal === 0, `résolution : produit ${state.product} (jamais 6), lot ${state.lot}, non attribué ${state.unal}`)

console.log('\n11. Code applicatif compatible avant / après la 179')
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
const lib = src('lib/api/batch-treatments.ts')
const probe = lib.match(/export async function batchTreatmentsAvailable[\s\S]*?\n}/)?.[0] || ''
ok(!/head: true/.test(probe) && /const value = !error/.test(probe), 'détection de la 179 : requête ordinaire, TOUTE erreur = indisponible (jamais HEAD, sans code d’erreur)')
for (const [file, legacy] of [['app/api/product-batches/adjust/route.ts', "rpc('adjust_batch_quantity'"], ['app/api/product-batches/expiry/route.ts', ".update({ expiry_date: newDate })"]]) {
  const r = src(file)
  ok(/if \(await batchTreatmentsAvailable\(admin\)\)/.test(r) && r.includes("rpc('treat_batch'") && r.includes(legacy),
    `${file.split('/').slice(-2).join('/')} : treat_batch si la 179 existe, sinon chemin d’origine`)
}
const resolveRoute = src('app/api/stock/batch-treatments/resolve/route.ts')
ok(!/from\('products'\)/.test(resolveRoute) && /p_product_id: access\.lot\.product_id/.test(resolveRoute) && /p_shop_id: access\.lot\.shop_id/.test(resolveRoute),
  'route de résolution : boutique et produit relus depuis le lot, aucune écriture du stock produit')
const treatRoute = src('app/api/stock/batch-treatments/route.ts')
ok(/p_shop_id: access\.lot\.shop_id/.test(treatRoute) && !/body\.shop_id/.test(treatRoute) && !/body\.supplier/.test(treatRoute),
  'route de traitement : boutique et fournisseur jamais pris du navigateur')
ok(/createSignedUrls\(paths, PHOTO_URL_SECONDS\)/.test(treatRoute) && /PHOTO_URL_SECONDS = 600/.test(lib) && !/buying_price|cost/.test(treatRoute),
  'historique : liens signés de 10 minutes (jamais enregistrés), aucun prix d’achat')
const photoRoute = src('app/api/stock/batch-treatments/photo/route.ts')
ok(/sniffImage\(bytes\)/.test(photoRoute) && /remove\(\[path\]\)/.test(photoRoute) && /batch_photo_orphan/.test(photoRoute) && /orphan: \{ bucket/.test(photoRoute),
  'photo : type réel vérifié ; refus → fichier supprimé ; échec du nettoyage → audit batch_photo_orphan + chemin renvoyé')
const ownerRoute = src('app/api/admin/owner/[ownerId]/route.ts')
ok(pos(ownerRoute, /purgeTreatmentPhotos\(admin, shopIds\)/) < pos(ownerRoute, /from\('shops'\)\.delete\(\)/) && /if \(!purge\.ok\)/.test(ownerRoute),
  'suppression d’un compte : photos de traitement supprimées AVANT les boutiques, refus s’il en reste')

console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
