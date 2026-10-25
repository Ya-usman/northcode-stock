// Jeu d'essai pour la validation LOCALE de 181 / 182 : relit en LECTURE SEULE (clé serveur de .env.local) les
// réglages de rôles des boutiques (shops.role_permissions, deleted_at) et les couples (boutique, rôle, actif) des
// membres — aucune donnée personnelle (ni e-mail, ni nom, ni identifiant d'utilisateur). Écrit un fichier SQL.
// Usage : node supabase/drafts/181_182_seed_from_prod.js <fichier.sql>
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const out = process.argv[2]
if (!out) { console.error('Usage : node 181_182_seed_from_prod.js <fichier.sql>'); process.exit(2) }
const q = s => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)
;(async () => {
  const shops = (await db.from('shops').select('id, deleted_at, role_permissions').order('id')).data
  const members = (await db.from('shop_members').select('shop_id, role, is_active').order('shop_id')).data
  if (!shops?.length || !members) throw new Error('lecture impossible')
  const lines = ['-- Jeu d\'essai généré depuis la production (lecture seule) — ' + new Date().toISOString()]
  for (const s of shops) lines.push(`INSERT INTO public.shops (id, deleted_at, role_permissions) VALUES (${q(s.id)}, ${q(s.deleted_at)}, ${s.role_permissions === null ? 'NULL' : q(JSON.stringify(s.role_permissions)) + '::jsonb'});`)
  for (const m of members) lines.push(`INSERT INTO public.shop_members (shop_id, role, is_active) VALUES (${q(m.shop_id)}, ${q(m.role)}, ${m.is_active ? 'true' : 'false'});`)
  fs.writeFileSync(out, lines.join('\n') + '\n')
  console.log(`jeu d'essai : ${shops.length} boutiques, ${members.length} membres → ${out}`)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
