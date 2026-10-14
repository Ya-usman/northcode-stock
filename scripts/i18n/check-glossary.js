#!/usr/bin/env node
// Contrôle du glossaire (scripts/i18n/glossary.json) : pour chaque notion, les chaînes dont le texte français
// en parle doivent employer le terme retenu dans chaque langue, et jamais un mot interdit. Lancé au build.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const glossary = JSON.parse(fs.readFileSync(path.join(__dirname, 'glossary.json'), 'utf8'))
const load = lang => JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${lang}.json`), 'utf8'))
const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]))
const fr = Object.fromEntries(flat(load('fr')))

let errors = 0
for (const term of glossary.terms) {
  const match = new RegExp(term.match, 'i')
  for (const [lang, rule] of Object.entries(term)) {
    if (!rule || typeof rule !== 'object' || !Array.isArray(rule.forbid)) continue
    const messages = Object.fromEntries(flat(load(lang)))
    const forbid = new RegExp(`(^|[^\\p{L}])(${rule.forbid.join('|')})(?![\\p{L}])`, 'iu')
    for (const [key, text] of Object.entries(fr)) {
      if (typeof text !== 'string' || !match.test(text)) continue
      const translated = messages[key]
      if (typeof translated !== 'string') continue
      const hit = translated.match(forbid)
      if (hit) {
        errors++
        console.error(`✗ ${lang} · ${key} : « ${hit[2]} » au lieu de « ${rule.use} » (${term.notion}) — « ${translated} »`)
      }
    }
  }
}
if (errors) {
  console.error(`\nGlossaire : ${errors} chaîne(s) à corriger (voir scripts/i18n/glossary.json).`)
  process.exit(1)
}
console.log('Glossaire : conforme.')
