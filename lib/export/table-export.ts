// Exports de l'app (7 oct. 2026) — UN format pour toutes les pages :
//  · Excel (.xlsx) : titre « StockShop · Ventes », boutique et période, date
//    d'export ; en-têtes aux couleurs StockShop, figés, avec filtres ; montants
//    = vrais nombres formatés (on peut les additionner), vraies dates, ligne de
//    totaux ; nom de fichier lisible ;
//  · CSV (second choix, comptables) : séparateur de la langue (« ; » en
//    français, « , » sinon), décimales à la virgule en français, accents (BOM).
// ExcelJS chargé seulement au moment d'exporter.

export type ExportColType = 'text' | 'money' | 'int' | 'number' | 'date' | 'datetime'
export interface ExportColumn { header: string; type?: ExportColType; width?: number }
export type ExportCell = string | number | Date | null | undefined
export interface ExportSpec {
  /** Ce qui est exporté : « Ventes », « Produits »… (titre et nom du fichier) */
  kind: string
  shopName: string
  /** « octobre 2026 », « du 1er au 7 oct. 2026 »… */
  period?: string | null
  columns: ExportColumn[]
  rows: ExportCell[][]
  /** Ligne de totaux (même nombre de cellules que de colonnes) */
  totals?: ExportCell[] | null
  locale: string
  /** Libellés déjà traduits */
  labels: { exportedOn: string; sheet?: string }
}

const BLUE = 'FF073E8A', BLUE_SOFT = 'FFE8F0FB', GREY = 'FF6B7280', BORDER = 'FFD6DEEB'

async function loadExcel(): Promise<typeof import('exceljs')> { const m: any = await import('exceljs'); return m.default ?? m }

const pad = (n: number) => String(n).padStart(2, '0')
const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()

/** « StockShop - Ventes - Boutique Alpha - 2026-10-07.xlsx » ; un export d'un jour ou d'un mois précis
 *  (caisse du 5 oct., dépenses d'octobre) porte ce jour ou ce mois au lieu de la date d'export */
export function exportFileName(kind: string, shopName: string, ext: 'xlsx' | 'csv', period?: string | null): string {
  // Plusieurs boutiques : la première « +N » (la liste complète est dans l'en-tête du fichier)
  const shops = shopName.split(', ').filter(Boolean)
  const who = shops.length > 1 ? `${shops[0]} +${shops.length - 1}` : shopName
  return `StockShop - ${safe(kind)} - ${safe(who)} - ${period ? safe(period) : isoDay()}.${ext}`
}

/** Date → même heure affichée dans Excel (Excel n'a pas de fuseau : on garde l'heure locale) */
const excelDate = (d: Date) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()))
const toDate = (v: ExportCell): Date | null => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) { const d = new Date(v.length === 10 ? `${v}T00:00:00` : v); return Number.isNaN(d.getTime()) ? null : d }
  return null
}
const toNumber = (v: ExportCell): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

export async function buildXlsx(spec: ExportSpec): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'StockShop'
  wb.title = `${spec.kind} — ${spec.shopName}`
  const ws = wb.addWorksheet(safe(spec.labels.sheet || spec.kind).slice(0, 31), { properties: { tabColor: { argb: BLUE } } })
  const n = spec.columns.length
  const lastCol = ws.getColumn(n).letter

  // En-tête du document
  const t1 = ws.addRow([`StockShop · ${spec.kind}`]); t1.font = { bold: true, size: 14, color: { argb: BLUE } }; t1.height = 22
  const t2 = ws.addRow([[spec.shopName, spec.period].filter(Boolean).join(' · ')]); t2.font = { bold: true, color: { argb: 'FF1F2937' } }
  const t3 = ws.addRow([spec.labels.exportedOn]); t3.font = { size: 9, color: { argb: GREY } }
  for (const r of [t1, t2, t3]) ws.mergeCells(`A${r.number}:${lastCol}${r.number}`)
  ws.addRow([])

  // En-têtes des colonnes
  const head = ws.addRow(spec.columns.map(c => c.header))
  head.height = 24
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    c.alignment = { vertical: 'middle', wrapText: true }
  })
  // Nombres à droite, dates centrées (en-tête et cellules alignés)
  const align = (c: ExportColumn) => (c.type === 'date' || c.type === 'datetime' ? 'center' : c.type && c.type !== 'text' ? 'right' : 'left') as 'center' | 'right' | 'left'
  // Texte avec un léger retrait : une colonne de nombres (à droite) ne colle pas au texte qui suit
  spec.columns.forEach((c, i) => { head.getCell(i + 1).alignment = { vertical: 'middle', horizontal: align(c), wrapText: true, ...(align(c) === 'left' ? { indent: 1 } : {}) } })
  ws.views = [{ state: 'frozen', ySplit: head.number }]

  // Formats : décimales seulement si la colonne en contient
  const hasDecimals = spec.columns.map((_, i) => spec.rows.some(r => { const v = toNumber(r[i]); return v !== null && !Number.isInteger(v) }))
  const numFmt = (c: ExportColumn, i: number) =>
    c.type === 'money' || c.type === 'number' ? (hasDecimals[i] ? '#,##0.00' : '#,##0')
      : c.type === 'int' ? '#,##0' : c.type === 'date' ? 'dd/mm/yyyy' : c.type === 'datetime' ? 'dd/mm/yyyy hh:mm' : undefined
  const put = (row: import('exceljs').Row, cells: ExportCell[]) => cells.forEach((v, i) => {
    const c = spec.columns[i]; const cell = row.getCell(i + 1)
    if (c?.type === 'date' || c?.type === 'datetime') { const d = toDate(v); cell.value = d ? excelDate(d) : (v ?? '') as any }
    else if (c?.type && c.type !== 'text') { const num = toNumber(v); cell.value = num ?? ((v ?? '') as any) }
    else cell.value = v instanceof Date ? excelDate(v) : (v ?? '') as any
    const f = c ? numFmt(c, i) : undefined
    if (f) cell.numFmt = f
    if (c && (c.type === 'date' || c.type === 'datetime')) cell.alignment = { horizontal: 'center' }
    else if (!c?.type || c.type === 'text') cell.alignment = { horizontal: 'left', indent: 1 }
  })

  const first = head.number + 1
  for (const r of spec.rows) put(ws.addRow([]), r)
  const lastData = ws.rowCount
  if (spec.rows.length) ws.autoFilter = { from: { row: head.number, column: 1 }, to: { row: lastData, column: n } }

  if (spec.totals) {
    const tr = ws.addRow([]); put(tr, spec.totals)
    tr.eachCell({ includeEmpty: true }, c => {
      c.font = { bold: true }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } }
      c.border = { top: { style: 'thin', color: { argb: BLUE } } }
    })
  }
  // Lignes alternées discrètes
  for (let r = first; r <= lastData; r++) if ((r - first) % 2 === 1) for (let i = 1; i <= n; i++) {
    ws.getRow(r).getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } }
  }
  for (let r = first; r <= lastData; r++) ws.getRow(r).eachCell({ includeEmpty: true }, c => { c.border = { bottom: { style: 'hair', color: { argb: BORDER } } } })

  // Largeurs : d'après le contenu (bornées)
  spec.columns.forEach((c, i) => {
    const lens = [c.header.length, ...spec.rows.slice(0, 500).map(r => {
      const v = r[i]; if (c.type === 'datetime') return 18; if (c.type === 'date') return 12
      const num = toNumber(v); return num !== null && c.type && c.type !== 'text' ? Math.round(num).toLocaleString('fr-FR').length + 2 : String(v ?? '').length
    })]
    ws.getColumn(i + 1).width = c.width ?? Math.min(48, Math.max(10, Math.max(...lens) + 2))
  })
  ws.pageSetup = { orientation: n > 5 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${head.number}:${head.number}` } as any

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** CSV : en-têtes + lignes (+ totaux), sans mise en page — pour les logiciels comptables */
export function buildCsv(spec: ExportSpec): Blob {
  const fr = spec.locale === 'fr'
  const sep = fr ? ';' : ','
  const quote = (s: string) => (/[";,\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const cell = (v: ExportCell, c?: ExportColumn): string => {
    if (v === null || v === undefined) return ''
    if (c?.type === 'date' || c?.type === 'datetime' || v instanceof Date) {
      const d = toDate(v)
      if (d) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}${c?.type === 'datetime' ? ` ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''}`
    }
    if (c?.type && c.type !== 'text') {
      const num = toNumber(v)
      if (num !== null) return fr ? String(num).replace('.', ',') : String(num)
    }
    return quote(String(v))
  }
  const lines = [spec.columns.map(c => quote(c.header)).join(sep), ...spec.rows.map(r => r.map((v, i) => cell(v, spec.columns[i])).join(sep))]
  if (spec.totals) lines.push(spec.totals.map((v, i) => cell(v, spec.columns[i])).join(sep))
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

/** Exporte et télécharge (partage natif dans l'app Android) */
export async function exportTable(spec: ExportSpec, format: 'xlsx' | 'csv', fileExtra?: string | null): Promise<void> {
  const { downloadOrShareBlob } = await import('@/lib/utils/native-share')
  const blob = format === 'xlsx' ? await buildXlsx(spec) : buildCsv(spec)
  await downloadOrShareBlob(blob, exportFileName(spec.kind, spec.shopName, format, fileExtra))
}
