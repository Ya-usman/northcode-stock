// deleteShops (lib/api/delete-shops.ts) — test PUR avec un faux client, aucun appel réseau ni base.
// Usage : node tests/e2e/delete-shops-pure.mjs   (Node ≥ 23 : lecture directe du TypeScript)
const { deleteShops } = await import(new URL('../../lib/api/delete-shops.ts', import.meta.url).href)
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m) }
function fake(rpcResult, legacyResult = { error: null }) {
  const log = []
  return { log, rpc: async (fn, args) => { log.push(['rpc', fn, args]); return rpcResult },
    from: (t) => ({ delete: () => ({ in: async (col, ids) => { log.push(['delete', t, col, ids]); return legacyResult } }) }) }
}
let a = fake({ error: null }); let r = await deleteShops(a, ['s1', 's1', '', 's2'])
ok(!r.error && a.log.length === 1 && a.log[0][1] === 'delete_shops' && JSON.stringify(a.log[0][2]) === '{"p_shop_ids":["s1","s2"]}', 'après 179 : delete_shops appelée une fois, identifiants dédoublonnés, aucun DELETE direct')
a = fake({ error: { code: 'PGRST202', message: 'Could not find the function' } }); r = await deleteShops(a, ['s1'])
ok(!r.error && a.log.length === 2 && a.log[1][0] === 'delete' && a.log[1][3][0] === 's1', 'avant 179 (PGRST202) : repli sur le DELETE d’origine')
a = fake({ error: { code: 'PGRST202' } }, { error: { code: '23503', message: 'fk' } }); r = await deleteShops(a, ['s1'])
ok(r.error?.code === '23503', 'avant 179 : une erreur du DELETE d’origine est renvoyée')
for (const [code, label] of [['23503', 'clé étrangère'], ['P0049', 'fichier encore stocké'], ['42501', 'droits'], ['57014', 'délai dépassé'],
                             ['42883', 'fonction inconnue côté base'], ['XX000', 'erreur base'], [undefined, 'erreur réseau / Storage sans code']]) {
  a = fake({ error: { code, message: label } }); r = await deleteShops(a, ['s1'])
  ok(r.error?.message === label && a.log.length === 1, `après 179 : ${label} (${code ?? 'sans code'}) renvoyé, JAMAIS de repli`)
}
a = fake({ error: null }); r = await deleteShops(a, [])
ok(!r.error && a.log.length === 0, 'liste vide : aucun appel')
console.log(`${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
