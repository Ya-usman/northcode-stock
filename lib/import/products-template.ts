// Modèle Excel d'import des produits (.xlsx) — dans la langue de la personne :
//  · « Produits » : en-têtes aux couleurs StockShop, obligatoires marqués « * »,
//    ligne figée, largeurs adaptées, unité en menu déroulant, nombres contrôlés,
//    code-barres en TEXTE (sinon Excel abîme les EAN-13 : 5,90026E+12) ;
//  · « Mode d'emploi » : étapes, colonnes expliquées, exemples (jamais importés) ;
//  · « Listes » (masquée) : les unités du menu déroulant.
// ExcelJS est chargé seulement au téléchargement.

import { PRODUCT_UNITS, IMPORT_MAX_ROWS, type ImportField, type ProductUnit } from './products-import'

/** ExcelJS chargé à la demande (paquet CommonJS : export par défaut selon l'outil) */
async function loadExcel(): Promise<typeof import('exceljs')> { const m: any = await import('exceljs'); return m.default ?? m }

const BLUE = 'FF073E8A', BLUE_SOFT = 'FFE8F0FB', GREY = 'FF6B7280', BORDER = 'FFD6DEEB'

export interface TemplateTexts {
  sheetProducts: string; sheetGuide: string; sheetLists: string
  columns: Record<ImportField, { header: string; required: boolean; help: string; example: string }>
  unitLabels: Record<ProductUnit, string>
  guideTitle: string; guideIntro: string; guideSteps: string[]
  guideColumnsTitle: string; guideColumn: string; guideRequired: string; guideMeaning: string; guideExample: string
  yes: string; no: string
  guideExamplesTitle: string; guideExamplesNote: string; examples: Partial<Record<ImportField, string | number>>[]
  guideUnitsTitle: string
  guideTipsTitle: string; guideTips: string[]
  validationTitle: string; validationUnit: string; validationNumber: string; validationInteger: string
}

const COLUMNS: { field: ImportField; width: number }[] = [
  { field: 'name', width: 36 }, { field: 'selling_price', width: 15 }, { field: 'buying_price', width: 15 },
  { field: 'quantity', width: 17 }, { field: 'unit', width: 18 }, { field: 'sku', width: 22 }, { field: 'low_stock_threshold', width: 17 },
]

export async function buildProductsTemplate(t: TemplateTexts, shopName: string): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'StockShop'
  wb.title = `${t.sheetProducts} — ${shopName}`
  const last = IMPORT_MAX_ROWS + 1
  const col = (i: number) => String.fromCharCode(65 + i)

  // ── Produits ──────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet(t.sheetProducts, { properties: { tabColor: { argb: BLUE } }, views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map(c => ({ key: c.field, width: c.width }))
  const header = ws.getRow(1)
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    const def = t.columns[c.field]
    cell.value = def.required ? `${def.header} *` : def.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } } }
    cell.note = { texts: [{ text: def.help }] } as any
  })
  header.height = 32

  // Plages de validation (API présente à l'exécution, absente des types d'ExcelJS)
  const validations = (ws as any).dataValidations as { add: (range: string, v: object) => void }
  COLUMNS.forEach((c, i) => {
    const range = `${col(i)}2:${col(i)}${last}`
    if (c.field === 'sku') ws.getColumn(i + 1).numFmt = '@' // texte : garde les zéros et les 13 chiffres
    if (c.field === 'unit') {
      validations.add(range, { type: 'list', allowBlank: true, formulae: [`'${t.sheetLists}'!$A$1:$A$${PRODUCT_UNITS.length}`], showErrorMessage: true, errorStyle: 'stop', errorTitle: t.validationTitle, error: t.validationUnit } as any)
    }
    if (c.field === 'selling_price' || c.field === 'buying_price') {
      validations.add(range, { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: t.validationTitle, error: t.validationNumber } as any)
    }
    if (c.field === 'quantity' || c.field === 'low_stock_threshold') {
      validations.add(range, { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: t.validationTitle, error: t.validationInteger } as any)
    }
  })

  // ── Mode d'emploi ─────────────────────────────────────────────────────────
  // Même grille de 7 colonnes que « Produits » : les exemples s'alignent sous
  // leurs en-têtes ; les textes courent sur toute la largeur (A:G).
  const g = wb.addWorksheet(t.sheetGuide, { properties: { tabColor: { argb: 'FF16A34A' } } })
  g.columns = COLUMNS.map(c => ({ width: c.width }))
  const LAST = col(COLUMNS.length - 1)
  const textRow = (text: string, opts: { height?: number; font?: Partial<import('exceljs').Font> } = {}) => {
    const r = g.addRow([text]); g.mergeCells(`A${r.number}:${LAST}${r.number}`)
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    if (opts.font) r.getCell(1).font = opts.font
    if (opts.height) r.height = opts.height
    return r
  }
  const title = g.addRow([t.guideTitle]); title.font = { bold: true, size: 16, color: { argb: BLUE } }; title.height = 26
  textRow(t.guideIntro, { font: { color: { argb: GREY } }, height: 20 })
  g.addRow([])
  t.guideSteps.forEach((s, i) => textRow(`${i + 1}.  ${s}`, { height: 21 }))
  g.addRow([])
  const section = (text: string) => { const r = g.addRow([text]); r.font = { bold: true, size: 12, color: { argb: BLUE } }; r.height = 20 }
  const headerCell = (c: import('exceljs').Cell) => {
    c.font = { bold: true, color: { argb: BLUE } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } }
    c.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
    c.alignment = { vertical: 'middle', wrapText: true }
  }

  // Les colonnes : A colonne · B obligatoire · C:F à quoi elle sert · G exemple
  section(t.guideColumnsTitle)
  const th = g.addRow([t.guideColumn, t.guideRequired, t.guideMeaning, '', '', '', t.guideExample])
  g.mergeCells(`C${th.number}:F${th.number}`)
  for (let i = 1; i <= COLUMNS.length; i++) headerCell(th.getCell(i))
  for (const c of COLUMNS) {
    const d = t.columns[c.field]
    const r = g.addRow([d.header, d.required ? t.yes : t.no, d.help, '', '', '', d.example])
    g.mergeCells(`C${r.number}:F${r.number}`)
    for (let i = 1; i <= COLUMNS.length; i++) {
      const cell = r.getCell(i)
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER } } }
    }
    r.getCell(7).numFmt = '@'
    if (d.required) r.getCell(2).font = { bold: true }
    r.height = d.help.length > 70 ? 32 : 21
  }
  g.addRow([])

  // Exemples : exactement comme dans « Produits » (jamais importés : cet onglet n'est pas lu)
  section(t.guideExamplesTitle)
  textRow(t.guideExamplesNote, { font: { italic: true, color: { argb: GREY } } })
  const ex = g.addRow(COLUMNS.map(c => t.columns[c.field].header + (t.columns[c.field].required ? ' *' : '')))
  for (let i = 1; i <= COLUMNS.length; i++) headerCell(ex.getCell(i))
  for (const e of t.examples) {
    const r = g.addRow(COLUMNS.map(c => e[c.field] ?? ''))
    r.getCell(6).numFmt = '@'
    for (let i = 1; i <= COLUMNS.length; i++) { const c = r.getCell(i); c.border = { bottom: { style: 'hair', color: { argb: BORDER } } }; c.alignment = { horizontal: 'left', vertical: 'middle' } }
    r.height = 21
  }
  g.addRow([])

  section(t.guideUnitsTitle)
  textRow(PRODUCT_UNITS.map(u => t.unitLabels[u]).join(' · '))
  g.addRow([])

  section(t.guideTipsTitle)
  for (const tip of t.guideTips) textRow(`•  ${tip}`, { height: tip.length > 120 ? 32 : 21 })
  g.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } as any

  // ── Listes (masquée) ──────────────────────────────────────────────────────
  const l = wb.addWorksheet(t.sheetLists, { state: 'hidden' })
  PRODUCT_UNITS.forEach((u, i) => { l.getCell(`A${i + 1}`).value = t.unitLabels[u] })

  wb.views = [{ activeTab: 0 } as any] // ouverture sur « Produits »
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

/** Lignes à corriger : mêmes colonnes + « Problème », prêtes à être réimportées */
export async function buildFixFile(t: TemplateTexts, problemHeader: string, rows: { raw: Partial<Record<ImportField, unknown>>; problem: string }[]): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(t.sheetProducts, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = [...COLUMNS.map(c => ({ key: c.field, width: c.width })), { key: 'problem', width: 60 }]
  const header = ws.getRow(1)
  ;[...COLUMNS.map(c => t.columns[c.field].header + (t.columns[c.field].required ? ' *' : '')), problemHeader].forEach((h, i) => {
    const cell = header.getCell(i + 1); cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === COLUMNS.length ? 'FFB91C1C' : BLUE } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  header.height = 28
  ws.getColumn(6).numFmt = '@'
  for (const r of rows) {
    const row = ws.addRow([...COLUMNS.map(c => (r.raw[c.field] ?? '') as any), r.problem])
    row.getCell(COLUMNS.length + 1).font = { color: { argb: 'FFB91C1C' } }
  }
  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
