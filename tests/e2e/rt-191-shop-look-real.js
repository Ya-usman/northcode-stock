// Migration 191 — nom court et couleur, test RÉEL sur Boutique Alpha (accord de l'utilisateur le 31 oct. 2026 : « Ok »
// pour modifier Alpha ou une boutique de test). Par la route normale PATCH /api/shops/settings (serveur LOCAL, vraie
// base), compte propriétaire :
//   A. enregistrement : nom court « Alpha » (espaces retirés) + couleur ambre ;
//   B. refus : même nom court pour « yahaya & zainab 2 » (même entreprise, casse différente) → 409, couleur hors palette
//      (rouge) → 400, nom court de 21 caractères → 400 ; rien de modifié ;
//   C. affichage : Paramètres (champ rempli, Ambre cochée), pastille « Alpha » au point ambre, repère « AL » ambre ;
//   D. RETOUR aux valeurs d'origine (nom court et couleur), vérifié en base.
// Usage : CAPTURE_BASE=http://localhost:3000 RT191_GO=oui node tests/e2e/rt-191-shop-look-real.js [dossier_captures]
process.env.CAPTURE_BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
if (process.env.RT191_GO !== 'oui') { console.error('Écriture réelle : RT191_GO=oui obligatoire (accord de l’utilisateur requis)'); process.exit(2) }
const fs = require('fs')
const path = require('path')
const { enableWrite, ALPHA } = require('./lib/write-mode.js')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const REF = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([^.]+)\./)[1]
const BASE = process.env.CAPTURE_BASE
const OUT = process.argv[2] || path.join(__dirname, 'out')
fs.mkdirSync(OUT, { recursive: true })
const wait = ms => new Promise(r => setTimeout(r, ms))
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 300) : ''}`) }
const OWNER = 'admin@northcode.ng'
const YZ = '11cd48d1-b558-49b1-bb8d-4275106dd33e'

;(async () => {
  const W = await enableWrite({ test: 'nom court et couleur réels après la 191', routes: [/\/api\/shops\/settings/] })
  const db = W.db
  const row = async id => (await db.from('shops').select('id, name, short_name, color, entity_id').eq('id', id).single()).data
  const A0 = await row(ALPHA), Y0 = await row(YZ)
  if (!A0 || !Y0 || A0.entity_id !== Y0.entity_id || A0.name !== 'Boutique Alpha') { console.log('Arrêt : boutiques inattendues, rien écrit.', A0, Y0); process.exit(1) }
  console.log(`Départ : Alpha nom court ${JSON.stringify(A0.short_name)}, couleur ${A0.color} · ${Y0.name} ${JSON.stringify(Y0.short_name)}, ${Y0.color}`)
  const target = A0.color === 'amber' ? 'pink' : 'amber'
  const targetLabel = target === 'amber' ? 'Ambre' : 'Rose'

  const { data: link } = await db.auth.admin.generateLink({ type: 'magiclink', email: OWNER })
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: sess, error: le } = await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (le) throw new Error('connexion : ' + le.message)
  const v = 'base64-' + Buffer.from(JSON.stringify(sess.session)).toString('base64url')
  const parts = []; for (let i = 0; i < v.length; i += 3180) parts.push(v.slice(i, i + 3180))
  const cookie = parts.map((p, i) => `sb-${REF}-auth-token.${i}=${p}`).join('; ')
  const patch = body => fetch(`${BASE}/api/shops/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fr', Cookie: cookie }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))

  try {
    console.log('\nA. Enregistrement')
    const a = await patch({ shop_id: ALPHA, short_name: '  Alpha  ', color: target })
    const A1 = await row(ALPHA)
    ok(a.status === 200 && A1.short_name === 'Alpha' && A1.color === target, `nom court « Alpha » (espaces retirés), couleur ${target} (${a.status})`, a)

    console.log('\nB. Refus')
    const dup = await patch({ shop_id: YZ, short_name: 'alpha' })
    ok(dup.status === 409 && /déjà utilisé/.test(dup.body.error || '') && (await row(YZ)).short_name === Y0.short_name, `même nom court dans l’entreprise : 409 « ${dup.body.error} »`, dup)
    const red = await patch({ shop_id: ALPHA, color: 'red' })
    ok(red.status === 400 && (await row(ALPHA)).color === target, `couleur hors palette : 400 « ${red.body.error} »`, red)
    const long = await patch({ shop_id: ALPHA, short_name: 'x'.repeat(21) })
    ok(long.status === 400 && (await row(ALPHA)).short_name === 'Alpha', `nom court de 21 caractères : 400 « ${long.body.error} »`, long)

    console.log('\nC. Affichage (lecture)')
    process.env.CAPTURE_EMAIL = OWNER; process.env.PIN_SHOP = ALPHA
    const { session } = require('./lib/capture.js')
    const s = await session({ width: 1366, height: 900, locale: 'fr' })
    await s.page.goto(`${BASE}/fr/settings`, { waitUntil: 'domcontentloaded', timeout: 120000 }); await wait(9000)
    ok(await s.page.getByTestId('shop-short-name').inputValue() === 'Alpha', 'Paramètres : champ « Nom court » = Alpha')
    ok(await s.page.getByTestId('shop-color').locator('[aria-checked="true"]').getAttribute('aria-label') === targetLabel, `Paramètres : « ${targetLabel} » cochée`)
    const chip = s.page.getByTestId('shop-scope-badge').first()
    ok((await chip.innerText()).trim() === 'Alpha' && await chip.locator(`[data-shop-dot="${target}"]`).count() === 1, `pastille « Alpha » au point ${target}`)
    const mark = s.page.locator('aside [data-shop-mark]').first()
    ok(await mark.getAttribute('data-shop-mark') === target && (await mark.innerText()).trim() === 'AL', `barre latérale : repère « AL » ${target}`)
    await s.page.getByTestId('shop-short-name').scrollIntoViewIfNeeded()
    await s.page.screenshot({ path: path.join(OUT, 'rt191-parametres.png') })
    await s.browser.close()
  } finally {
    console.log('\nD. Retour aux valeurs d’origine')
    const back = await patch({ shop_id: ALPHA, short_name: A0.short_name, color: A0.color })
    const A2 = await row(ALPHA), Y2 = await row(YZ)
    ok(back.status === 200 && A2.short_name === A0.short_name && A2.color === A0.color, `Alpha remise : nom court ${JSON.stringify(A2.short_name)}, couleur ${A2.color}`, back)
    ok(Y2.short_name === Y0.short_name && Y2.color === Y0.color, `${Y0.name} jamais modifiée`)
    await c.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  console.log(`\n${pass} réussis, ${fail} échec(s)`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); console.log(`\n${pass} réussis, ${fail} échec(s) — interrompu`); process.exit(1) })
