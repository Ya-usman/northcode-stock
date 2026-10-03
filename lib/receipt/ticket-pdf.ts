// Rendu d'un ticket (lignes abstraites) en PDF à la largeur du rouleau :
// page de 58 ou 80 mm de large, hauteur calculée au contenu. Envoyé à
// l'impression système (pilote USB / service d'impression Android), il sort
// au bon format sur une thermique, sans mise à l'échelle.
import type { TicketLine, TicketWidth } from './ticket'

// Largeur imprimable réelle d'un rouleau (hors marges mécaniques)
const PRINTABLE: Record<TicketWidth, number> = { 58: 48, 80: 72 }
// Corps de texte (pt) — plus petits sur 58 mm pour que « TOTAL  1 250 000 F CFA » tienne
const SIZES: Record<TicketWidth, Record<'sm' | 'md' | 'lg' | 'xl', number>> = {
  58: { sm: 7, md: 8.5, lg: 10.5, xl: 12 },
  80: { sm: 7.5, md: 9, lg: 11.5, xl: 14 },
}
const PT_TO_MM = 0.3528

// Helvetica (police standard PDF) ne couvre que Latin-1 : on retire ce qui
// sortirait en carré (coche, lettres haoussa à crochet…).
function clean(s: string): string {
  return s
    // Espaces fines / insécables des formats de nombres (fr-FR : U+202F) → espace normale
    .replace(/[    ]/g, ' ')
    .replace(/[ɗƊ]/g, 'd').replace(/[ƙƘ]/g, 'k').replace(/[ƴƳ]/g, 'y')
    .replace(/[^\u0000-ÿ–—‘’“”…]/g, '')
}

function paint(doc: any, width: TicketWidth, lines: TicketLine[]): number {
  const printable = PRINTABLE[width]
  const x0 = (width - printable) / 2
  const x1 = x0 + printable
  const sizes = SIZES[width]
  let y = 5

  const setFont = (size: number, bold?: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(0, 0, 0)
  }
  const lineH = (size: number) => size * PT_TO_MM * 1.35
  // Tronque avec « … » pour tenir dans `max` mm
  const fit = (text: string, max: number): string => {
    if (doc.getTextWidth(text) <= max) return text
    let t = text
    while (t.length > 1 && doc.getTextWidth(t + '…') > max) t = t.slice(0, -1)
    return t + '…'
  }

  for (const l of lines) {
    if (l.kind === 'rule') {
      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.25)
      doc.setLineDashPattern([0.8, 0.8], 0)
      doc.line(x0, y + 0.8, x1, y + 0.8)
      doc.setLineDashPattern([], 0)
      y += 3
      continue
    }
    if (l.kind === 'space') { y += l.h ?? 2; continue }
    if (l.kind === 'image') {
      // 8 points par mm (203 dpi) : même taille physique qu'en ESC/POS
      const wMm = Math.min(printable, l.logo.width / 8)
      const hMm = (l.logo.height / l.logo.width) * wMm
      // 'FAST' : compression Flate — sans elle, jsPDF stocke chaque bitmap brut (≈ 100 Ko par image)
      try { doc.addImage(l.logo.dataUrl, 'PNG', x0 + (printable - wMm) / 2, y, wMm, hMm, undefined, 'FAST') } catch { /* logo illisible : on continue sans */ }
      y += hMm + 1
      continue
    }

    const size = sizes[l.size ?? 'md']
    setFont(size, l.bold)
    const h = lineH(size)

    if (l.kind === 'text') {
      const rows: string[] = doc.splitTextToSize(clean(l.text), printable)
      for (const r of rows) {
        const x = l.align === 'center' ? x0 + printable / 2 : l.align === 'right' ? x1 : x0
        doc.text(r, x, y + size * PT_TO_MM, { align: l.align ?? 'left' })
        y += h
      }
      continue
    }
    if (l.kind === 'row') {
      const right = clean(l.right)
      const rw = doc.getTextWidth(right)
      const leftFull = clean(l.left)
      // Libellé + montant trop larges (« Montant payé  251 200 F CFA » en 58 mm) :
      // deux lignes plutôt qu'un libellé tronqué — même règle que l'ESC/POS (fitRow)
      if (doc.getTextWidth(leftFull) > printable - rw - 2) {
        doc.text(fit(leftFull, printable), x0, y + size * PT_TO_MM)
        y += h
        doc.text(right, x1, y + size * PT_TO_MM, { align: 'right' })
        y += h
        continue
      }
      doc.text(leftFull, x0, y + size * PT_TO_MM)
      doc.text(right, x1, y + size * PT_TO_MM, { align: 'right' })
      y += h
      continue
    }
    if (l.kind === 'cols') {
      let x = x0
      l.cells.forEach((cell, i) => {
        const w = printable * l.widths[i]
        const align = l.aligns[i]
        const text = fit(clean(cell), w - 1)
        const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 0.5 : x
        doc.text(text, tx, y + size * PT_TO_MM, { align })
        x += w
      })
      y += h
    }
  }
  return y
}

export async function renderTicketPdf(lines: TicketLine[], width: TicketWidth): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  // 1re passe : mesurer la hauteur sur une page très haute, 2e passe : page ajustée
  const probe = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, 2000] })
  const height = Math.max(40, paint(probe, width, lines) + 8)
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [width, height] })
  paint(doc, width, lines)
  return doc.output('blob') as Blob
}
