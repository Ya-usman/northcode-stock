// Lecture du fichier d'import dans le navigateur : Excel (.xlsx) ou CSV
// (virgule, point-virgule ou tabulation ; UTF-8 ou Windows-1252, l'encodage
// d'« Enregistrer sous CSV » dans un Excel français). Repère la ligne d'en-têtes
// dans les premières lignes et renvoie des lignes brutes champ → valeur ; les
// nombres d'Excel restent des nombres (pas de question de virgule).
// ExcelJS n'est chargé qu'ici, à l'ouverture d'un fichier .xlsx.

import { headerField, IMPORT_MAX_ROWS, type ImportField, type RawRow } from './products-import'

/** ExcelJS chargé à la demande (paquet CommonJS : export par défaut selon l'outil) */
async function loadExcel(): Promise<typeof import('exceljs')> { const m: any = await import('exceljs'); return m.default ?? m }

export type ReadResult =
  | { ok: true; rows: RawRow[]; columns: ImportField[]; truncated: boolean }
  | { ok: false; error: 'unsupported_format' | 'old_excel' | 'empty' | 'no_headers' | 'missing_columns' | 'unreadable'; missing?: ImportField[] }

/** Repère la ligne d'en-têtes (≥ 2 colonnes reconnues) parmi les 10 premières */
function toRows(table: unknown[][]): ReadResult {
  const nonEmpty = table.filter(r => r.some(c => String(c ?? '').trim() !== ''))
  if (!nonEmpty.length) return { ok: false, error: 'empty' }
  let headerIdx = -1, map: (ImportField | null)[] = []
  for (let i = 0; i < Math.min(table.length, 10); i++) {
    const m = (table[i] || []).map(headerField)
    if (m.filter(Boolean).length >= 2) { headerIdx = i; map = m; break }
  }
  if (headerIdx < 0) return { ok: false, error: 'no_headers' }
  const columns = Array.from(new Set(map.filter(Boolean))) as ImportField[]
  const missing = (['name', 'selling_price'] as ImportField[]).filter(f => !columns.includes(f))
  if (missing.length) return { ok: false, error: 'missing_columns', missing }

  const rows: RawRow[] = []
  for (let i = headerIdx + 1; i < table.length; i++) {
    const cells = table[i] || []
    if (!cells.some(c => String(c ?? '').trim() !== '')) continue // lignes vides ignorées
    const values: RawRow['values'] = {}
    map.forEach((f, j) => { if (f && values[f] === undefined) values[f] = cells[j] })
    rows.push({ line: i + 1, values }) // numéro de ligne tel qu'affiché dans Excel
  }
  if (!rows.length) return { ok: false, error: 'empty' }
  return { ok: true, rows: rows.slice(0, IMPORT_MAX_ROWS), columns, truncated: rows.length > IMPORT_MAX_ROWS }
}

// ── CSV ─────────────────────────────────────────────────────────────────────
function decode(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  // Caractère de remplacement = pas de l'UTF-8 : Excel français enregistre en Windows-1252
  return (utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8).replace(/^﻿/, '')
}

function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const count = (c: string) => firstLine.split(c).length - 1
  const sep = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]
  const out: string[][] = []
  let row: string[] = [], cur = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') quoted = true
    else if (ch === sep) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); out.push(row); row = []; cur = ''
    } else cur += ch
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row) }
  return out
}

// ── Excel ───────────────────────────────────────────────────────────────────
function cellValue(v: any): unknown {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('')
  if ('result' in v) return cellValue(v.result) // formule : sa valeur calculée
  if ('text' in v) return v.text                 // lien hypertexte
  return String(v)
}

async function readXlsx(buf: ArrayBuffer): Promise<ReadResult> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  // Feuille des produits : la première feuille visible qui a des en-têtes reconnus
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== 'visible') continue
    const table: unknown[][] = []
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = (row.values as any[]).slice(1).map(cellValue) // values[0] est vide (index 1)
      table[n - 1] = vals
    })
    for (let i = 0; i < table.length; i++) table[i] ??= []
    const r = toRows(table)
    // Feuille avec en-têtes (même vide) : c'est elle — jamais les exemples du « Mode d'emploi »
    if (r.ok || r.error !== 'no_headers') return r
  }
  return { ok: false, error: 'no_headers' }
}

export async function readImportFile(file: File): Promise<ReadResult> {
  const name = file.name.toLowerCase()
  try {
    if (name.endsWith('.xls')) return { ok: false, error: 'old_excel' }
    const buf = await file.arrayBuffer()
    if (name.endsWith('.xlsx')) return await readXlsx(buf)
    if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv') return toRows(parseCsv(decode(buf)))
    return { ok: false, error: 'unsupported_format' }
  } catch {
    return { ok: false, error: 'unreadable' }
  }
}
