// Reçu public : économie du client (prix de gros) sur une VRAIE vente TEST (rt-202 : 5 × 450 F au lieu de 500 F).
// LECTURE SEULE (page publique du reçu, aucune connexion). Usage : CAPTURE_BASE=http://localhost:3000 node tests/e2e/receipt-saving-ux.js
const BASE = process.env.CAPTURE_BASE || 'http://localhost:3000'
const fs = require('fs')
const ROOT = require('path').resolve(__dirname, '../..')
const env = {}
for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
const db = require(ROOT + '/node_modules/@supabase/supabase-js').createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { chromium } = require('playwright-core')
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }

;(async () => {
  const { data: item } = await db.from('sale_items').select('sale_id, quantity, unit_price, original_price').eq('product_name', 'TEST Gros (rt-202)').eq('quantity', 5).limit(1).single()
  const { data: sale } = await db.from('sales').select('sale_number, receipt_token').eq('id', item.sale_id).single()
  console.log(`Vente ${sale.sale_number} : ${item.quantity} × ${item.unit_price} (prix normal ${item.original_price})`)
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const writes = []; page.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) writes.push(r.url()) })
  await page.goto(`${BASE}/r/${sale.receipt_token}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForTimeout(2500)
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
  ok(text.includes(sale.sale_number), `reçu ${sale.sale_number} affiché`)
  ok(/Prix normal 500 F CFA · économie -250 F CFA/.test(text), 'ligne : « Prix normal 500 F CFA · économie -250 F CFA »', text.slice(0, 400))
  ok(/Vous économisez 250 F CFA/.test(text), 'sous le total : « Vous économisez 250 F CFA »')
  ok(!writes.length, `aucune écriture (${writes.length})`, writes)
  await page.screenshot({ path: `${__dirname}/out/receipt-saving.png`, fullPage: true })
  await browser.close()
  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message.slice(0, 400)); process.exit(1) })
