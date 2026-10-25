// Banc de la 184 : relève en LECTURE SEULE les réglages de rôles réels (shops.role_permissions non vides) et les écrit
// dans un fichier JSON local (tableau de réglages, SANS identifiant de boutique). Jamais dans le dépôt.
// Usage : node supabase/drafts/184_configs_from_prod.js <fichier.json>
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const out = process.argv[2]
if (!out) { console.error('fichier de sortie manquant'); process.exit(2) }
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
;(async () => {
  const { data, error } = await db.from('shops').select('role_permissions').not('role_permissions', 'is', null)
  if (error) { console.error('lecture impossible :', error.message); process.exit(1) }
  const configs = [...new Set(data.map(r => JSON.stringify(r.role_permissions)))].map(s => JSON.parse(s))
  fs.writeFileSync(out, JSON.stringify(configs))
  console.log(`${configs.length} réglage(s) réel(s) distinct(s) écrit(s) dans ${out}`)
})()
