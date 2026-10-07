// Modèle Excel d'import — GÉNÉRIQUE (produits, clients, fournisseurs), dans la
// langue de la personne :
//  · onglet principal : en-têtes aux couleurs StockShop, obligatoires marqués
//    « * », ligne figée, largeurs adaptées, contrôles Excel (nombres, liste),
//    colonnes « texte » (code-barres, téléphone) pour qu'Excel n'abîme rien ;
//  · « Mode d'emploi » : étapes, colonnes expliquées, exemples (jamais importés),
//    liste des valeurs permises, conseils ;
//  · « Listes » (masquée) : les valeurs du menu déroulant.
// Plus le fichier « lignes à corriger » (mêmes colonnes + « Problème »).
// ExcelJS est chargé seulement au téléchargement.

import { IMPORT_MAX_ROWS } from './products-import'

/** ExcelJS chargé à la demande (paquet CommonJS : export par défaut selon l'outil) */
async function loadExcel(): Promise<typeof import('exceljs')> { const m: any = await import('exceljs'); return m.default ?? m }

const BLUE = 'FF073E8A', BLUE_SOFT = 'FFE8F0FB', GREY = 'FF6B7280', BORDER = 'FFD6DEEB'

export interface TemplateColumn {
  key: string
  header: string
  required: boolean
  help: string
  example: string
  width: number
  /** Contrôle Excel : nombre décimal ≥ 0, entier ≥ 0, valeur de la liste, cellule au format Texte, ou vraie date (JJ/MM/AAAA) */
  validation?: 'decimal' | 'whole' | 'list' | 'text' | 'date'
}

export interface TemplateSpec {
  title: string
  sheetMain: string; sheetGuide: string; sheetLists: string
  columns: TemplateColumn[]
  /** Valeurs du menu déroulant (colonne validation « list ») et leur titre dans le mode d'emploi */
  listValues?: string[]; listTitle?: string
  guideTitle: string; guideIntro: string; guideSteps: string[]
  guideColumnsTitle: string; guideColumn: string; guideRequired: string; guideMeaning: string; guideExample: string
  yes: string; no: string
  guideExamplesTitle: string; guideExamplesNote: string; examples: Record<string, string | number>[]
  guideTipsTitle: string; guideTips: string[]
  validationTitle: string; validationList: string; validationNumber: string; validationInteger: string
  validationDate?: string
}

const col = (i: number) => String.fromCharCode(65 + i)
const blob = (buffer: ArrayBuffer) => new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

export async function buildImportTemplate(s: TemplateSpec): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'StockShop'
  wb.title = s.title
  const n = s.columns.length
  const last = IMPORT_MAX_ROWS + 1

  // ── Onglet principal ─────────────────────────────────────────────────────
  const ws = wb.addWorksheet(s.sheetMain, { properties: { tabColor: { argb: BLUE } }, views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = s.columns.map(c => ({ key: c.key, width: c.width }))
  const header = ws.getRow(1)
  s.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = c.required ? `${c.header} *` : c.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } } }
    cell.note = { texts: [{ text: c.help }] } as any
  })
  header.height = 32

  // Plages de validation (API présente à l'exécution, absente des types d'ExcelJS)
  const validations = (ws as any).dataValidations as { add: (range: string, v: object) => void }
  s.columns.forEach((c, i) => {
    const range = `${col(i)}2:${col(i)}${last}`
    if (c.validation === 'text') ws.getColumn(i + 1).numFmt = '@' // garde les zéros, les « + » et les longs codes
    if (c.validation === 'list' && s.listValues?.length) {
      validations.add(range, { type: 'list', allowBlank: true, formulae: [`'${s.sheetLists}'!$A$1:$A$${s.listValues.length}`], showErrorMessage: true, errorStyle: 'stop', errorTitle: s.validationTitle, error: s.validationList })
    }
    if (c.validation === 'decimal') {
      validations.add(range, { type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: s.validationTitle, error: s.validationNumber })
    }
    if (c.validation === 'whole') {
      validations.add(range, { type: 'whole', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0], showErrorMessage: true, errorTitle: s.validationTitle, error: s.validationInteger })
    }
    if (c.validation === 'date') {
      ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy'
      // ExcelJS n'accepte que des dates fixes ici (pas de TODAY()) : Excel exige une vraie date ;
      // « pas dans le futur » est contrôlé à la vérification de l'import
      validations.add(range, { type: 'date', operator: 'between', allowBlank: true, formulae: [new Date(Date.UTC(1990, 0, 1, 12)), new Date(Date.UTC(2100, 11, 31, 12))], showErrorMessage: true, errorTitle: s.validationTitle, error: s.validationDate || s.validationNumber })
    }
  })

  // ── Mode d'emploi ────────────────────────────────────────────────────────
  // Grille : celle de l'onglet principal quand il est large (exemples alignés
  // sous leurs en-têtes) ; sinon 4 colonnes de lecture confortable.
  const wide = n >= 6
  const grid = wide ? n : 4
  const g = wb.addWorksheet(s.sheetGuide, { properties: { tabColor: { argb: 'FF16A34A' } } })
  // En grille large, la dernière colonne porte aussi les « Exemple » : au moins 28 de large
  g.columns = wide ? s.columns.map((c, i) => ({ width: i === n - 1 ? Math.max(c.width, 28) : c.width })) : [{ width: 32 }, { width: 22 }, { width: 56 }, { width: 26 }]
  const LAST = col(grid - 1)
  const meaningEnd = col(grid - 2) // « À quoi elle sert » : de C à l'avant-dernière colonne
  // Hauteur d'une ligne de texte enroulé : d'après la longueur et la largeur disponible (≈ 1 caractère par unité de largeur)
  const widths = (g.columns as any[]).map(c => Number(c.width) || 10)
  const meaningWidth = widths.slice(2, grid - 1).reduce((a, b) => a + b, 0)
  const fullWidth = widths.slice(0, grid).reduce((a, b) => a + b, 0)
  // Estimation prudente (≈ 0,85 caractère par unité de largeur, 20 points par ligne) : rogner un texte
  // d'aide est pire qu'une ligne un peu haute
  const heightFor = (text: string, width: number) => Math.max(21, Math.ceil(text.length / Math.max(20, width * 0.85)) * 20 + 6)
  const textRow = (text: string, opts: { height?: number; font?: Partial<import('exceljs').Font> } = {}) => {
    const r = g.addRow([text]); g.mergeCells(`A${r.number}:${LAST}${r.number}`)
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' }
    if (opts.font) r.getCell(1).font = opts.font
    if (opts.height) r.height = opts.height
    return r
  }
  const title = g.addRow([s.guideTitle]); title.font = { bold: true, size: 16, color: { argb: BLUE } }; title.height = 26
  textRow(s.guideIntro, { font: { color: { argb: GREY } }, height: 20 })
  g.addRow([])
  s.guideSteps.forEach((st, i) => textRow(`${i + 1}.  ${st}`, { height: heightFor(st, fullWidth) }))
  g.addRow([])
  const section = (text: string) => { const r = g.addRow([text]); r.font = { bold: true, size: 12, color: { argb: BLUE } }; r.height = 20 }
  const headerCell = (c: import('exceljs').Cell) => {
    c.font = { bold: true, color: { argb: BLUE } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_SOFT } }
    c.border = { bottom: { style: 'thin', color: { argb: BORDER } } }
    c.alignment = { vertical: 'middle', wrapText: true }
  }
  const lineRow = (values: (string | number)[]) => {
    const cells = Array.from({ length: grid }, () => '' as string | number)
    values.forEach((v, i) => { cells[i] = v })
    return g.addRow(cells)
  }

  // Les colonnes : A colonne · B obligatoire · C… à quoi elle sert · dernière : exemple
  section(s.guideColumnsTitle)
  const th = lineRow([s.guideColumn, s.guideRequired, s.guideMeaning])
  th.getCell(grid).value = s.guideExample
  if (meaningEnd !== 'C') g.mergeCells(`C${th.number}:${meaningEnd}${th.number}`)
  for (let i = 1; i <= grid; i++) headerCell(th.getCell(i))
  for (const c of s.columns) {
    const r = lineRow([c.header, c.required ? s.yes : s.no, c.help])
    r.getCell(grid).value = c.example
    if (meaningEnd !== 'C') g.mergeCells(`C${r.number}:${meaningEnd}${r.number}`)
    for (let i = 1; i <= grid; i++) {
      const cell = r.getCell(i)
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = { bottom: { style: 'hair', color: { argb: BORDER } } }
    }
    r.getCell(grid).numFmt = '@'
    if (c.required) r.getCell(2).font = { bold: true }
    r.height = heightFor(c.help, meaningWidth)
  }
  g.addRow([])

  // Exemples : mêmes colonnes que l'onglet principal (jamais importés : cet onglet n'est pas lu)
  section(s.guideExamplesTitle)
  textRow(s.guideExamplesNote, { font: { italic: true, color: { argb: GREY } } })
  const ex = g.addRow(s.columns.map(c => c.header + (c.required ? ' *' : '')))
  for (let i = 1; i <= n; i++) headerCell(ex.getCell(i))
  for (const e of s.examples) {
    const r = g.addRow(s.columns.map(c => e[c.key] ?? ''))
    s.columns.forEach((c, i) => { if (c.validation === 'text') r.getCell(i + 1).numFmt = '@' })
    for (let i = 1; i <= n; i++) { const c = r.getCell(i); c.border = { bottom: { style: 'hair', color: { argb: BORDER } } }; c.alignment = { horizontal: 'left', vertical: 'middle' } }
    r.height = 21
  }
  g.addRow([])

  if (s.listValues?.length && s.listTitle) {
    section(s.listTitle)
    textRow(s.listValues.join(' · '))
    g.addRow([])
  }

  section(s.guideTipsTitle)
  for (const tip of s.guideTips) textRow(`•  ${tip}`, { height: heightFor(tip, fullWidth) })
  g.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } as any

  // ── Listes (masquée) ─────────────────────────────────────────────────────
  const l = wb.addWorksheet(s.sheetLists, { state: 'hidden' })
  ;(s.listValues || []).forEach((v, i) => { l.getCell(`A${i + 1}`).value = v })

  wb.views = [{ activeTab: 0 } as any] // ouverture sur l'onglet principal
  return blob(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

/** Lignes à corriger : mêmes colonnes + « Problème », prêtes à être réimportées */
export async function buildImportFixFile(
  s: Pick<TemplateSpec, 'sheetMain' | 'columns'>,
  problemHeader: string,
  rows: { raw: Record<string, unknown>; problem: string }[],
): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(s.sheetMain, { views: [{ state: 'frozen', ySplit: 1 }] })
  const n = s.columns.length
  ws.columns = [...s.columns.map(c => ({ key: c.key, width: c.width })), { key: 'problem', width: 60 }]
  const header = ws.getRow(1)
  ;[...s.columns.map(c => c.header + (c.required ? ' *' : '')), problemHeader].forEach((h, i) => {
    const cell = header.getCell(i + 1); cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === n ? 'FFB91C1C' : BLUE } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  header.height = 28
  s.columns.forEach((c, i) => { if (c.validation === 'text') ws.getColumn(i + 1).numFmt = '@'; if (c.validation === 'date') ws.getColumn(i + 1).numFmt = 'dd/mm/yyyy' })
  for (const r of rows) {
    const row = ws.addRow([...s.columns.map(c => (r.raw[c.key] ?? '') as any), r.problem])
    row.getCell(n + 1).font = { color: { argb: 'FFB91C1C' } }
  }
  return blob(await wb.xlsx.writeBuffer() as ArrayBuffer)
}
