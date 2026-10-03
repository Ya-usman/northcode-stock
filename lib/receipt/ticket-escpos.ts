// Rendu d'un ticket (lignes abstraites) en octets ESC/POS pour une imprimante
// thermique (Bluetooth SPP aujourd'hui, réseau demain). Même modèle que le
// PDF : seule la sortie change. L'encodeur gère les pages de code (accents),
// le retour à la ligne et les tableaux ; 32 colonnes en 58 mm, 48 en 80 mm.
import type { TicketLine, TicketSize, TicketWidth } from './ticket'

export const ESCPOS_COLUMNS: Record<TicketWidth, number> = { 58: 32, 80: 48 }

export type EscPosMapping = 'epson' | 'xprinter' | 'pos-5890' | 'pos-8360' | 'sunmi' | 'bixolon' | 'star' | 'citizen'

// Caractères absents des pages de code 437/858 des imprimantes → équivalents sûrs
function safe(s: string): string {
  return s
    .replace(/[    ]/g, ' ')
    .replace(/…/g, '...')
    .replace(/[ɗƊ]/g, 'd').replace(/[ƙƘ]/g, 'k').replace(/[ƴƳ]/g, 'y')
}

// Libellé à gauche, valeur à droite ; si la ligne est trop étroite (58 mm),
// la valeur passe sur la ligne suivante, alignée à droite — jamais de troncature.
function fitRow(left: string, right: string, cols: number): string[] {
  const l = safe(left), r = safe(right)
  if (l.length + 1 + r.length <= cols) return [l + ' '.repeat(cols - l.length - r.length) + r]
  return [l.slice(0, cols), ' '.repeat(Math.max(0, cols - r.length)) + r.slice(0, cols)]
}

export async function encodeTicketEscPos(lines: TicketLine[], width: TicketWidth, opts?: { mapping?: EscPosMapping }): Promise<Uint8Array> {
  const { default: ReceiptPrinterEncoder } = await import('@point-of-sale/receipt-printer-encoder')
  const columns = ESCPOS_COLUMNS[width]
  const enc = new ReceiptPrinterEncoder({
    language: 'esc-pos',
    columns,
    codepageMapping: opts?.mapping ?? 'epson',
    feedBeforeCut: 4,
  })
  enc.initialize().codepage('auto')

  // xl : double largeur + hauteur si le texte tient sur la moitié des colonnes,
  // sinon double hauteur seule ; lg : double hauteur ; md/sm : normal.
  const style = (bold: boolean | undefined, size: TicketSize | undefined, textLen: number) => {
    enc.bold(!!bold)
    if (size === 'xl') enc.size(textLen <= Math.floor(columns / 2) ? 2 : 1, 2)
    else if (size === 'lg') enc.size(1, 2)
    else enc.size(1, 1)
  }
  const reset = () => { enc.bold(false); enc.size(1, 1); enc.align('left') }

  for (const l of lines) {
    if (l.kind === 'rule') { reset(); enc.line('-'.repeat(columns)); continue }
    if (l.kind === 'space') { enc.newline(); continue }
    if (l.kind === 'image') {
      // Déjà tramé en noir et blanc : simple seuil. Dimensions multiples de 8.
      if (l.logo.source) {
        try { enc.align('center').image(l.logo.source as any, l.logo.width, l.logo.height, 'threshold') } catch { /* logo illisible : on continue sans */ }
        enc.align('left')
      }
      continue
    }
    if (l.kind === 'text') {
      const text = safe(l.text)
      style(l.bold, l.size, text.length)
      enc.align(l.align ?? 'left').line(text)
      reset()
      continue
    }
    if (l.kind === 'row') {
      // double hauteur garde toutes les colonnes ; jamais de double largeur sur une ligne à deux bords
      enc.bold(!!l.bold)
      enc.size(1, l.size === 'xl' || l.size === 'lg' ? 2 : 1)
      enc.align('left')
      for (const row of fitRow(l.left, l.right, columns)) enc.line(row)
      reset()
      continue
    }
    if (l.kind === 'cols') {
      enc.bold(!!l.bold)
      enc.size(1, 1)
      const widths = l.widths.map(w => Math.max(2, Math.round(columns * w)))
      widths[widths.length - 1] = Math.max(2, columns - widths.slice(0, -1).reduce((a, b) => a + b, 0))
      enc.table(
        widths.map((w, i) => ({ width: w, align: l.aligns[i], overflow: 'ellipsis' as const })),
        [l.cells.map(safe)],
      )
      reset()
    }
  }
  enc.newline(2).cut('partial')
  return enc.encode()
}
