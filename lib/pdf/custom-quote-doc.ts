// Devis sur mesure en PDF (jsPDF, 4 nov. 2026) : construit sur le SERVEUR, joint à l'e-mail du devis
// (/api/admin/custom-quotes). Même allure que le bon de commande (lib/pdf/purchase-order-doc) : bandeau StockShop, bloc
// client, tableau, total, lien de paiement, validité. Libellés fournis traduits par l'appelant.

const HAUSA_PLAIN: Record<string, string> = { 'ɗ': 'd', 'Ɗ': 'D', 'ƙ': 'k', 'Ƙ': 'K', 'ɓ': 'b', 'Ɓ': 'B', 'ƴ': 'y', 'Ƴ': 'Y', '’': "'", '‘': "'", '“': '"', '”': '"' }
/** Caractères que Helvetica sait encoder (lettres haoussa ramenées à la lettre simple, symboles monétaires en code) */
function clean(value: string | number): string {
  return String(value)
    .replace(/[ɗƊƙƘɓƁƴƳ’‘“”]/g, c => HAUSA_PLAIN[c] || c)
    .replace(/₦/g, 'NGN ').replace(/€/g, 'EUR ').replace(/£/g, 'GBP ')
    .replace(/[  ]/g, ' ').replace(/[·•]/g, '-').replace(/[−–—]/g, '-')
    .replace(/[^ -ÿ]/g, '')
}

export interface CustomQuotePDFParams {
  reference: string
  dateStr: string
  validUntilStr: string
  clientName: string
  clientCountry: string
  lines: { label: string; detail: string; amount: string }[]
  totalLabel: string
  totalAmount: string
  payUrl: string
  note?: string | null
  labels: {
    title: string; reference: string; date: string; validUntil: string; client: string; country: string
    colItem: string; colDetail: string; colAmount: string; pay: string; noteTitle: string; footer: string
  }
}

export async function buildCustomQuoteDoc(p: CustomQuotePDFParams, opts: { logoBase64?: string | null; wordmarkBase64?: string | null } = {}) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const BLUE: [number, number, number] = [7, 62, 138]

  // Bandeau
  doc.setFillColor(...BLUE); doc.rect(0, 0, W, 28, 'F')
  // Logo officiel en blanc (cercle « S » + « StockShop » en Montserrat, public/brand/stockshop-wordmark-white.png) ;
  // à défaut, l'icône et le nom en texte, puis le carré « S »
  let drawn = false
  if (opts.wordmarkBase64) {
    try {
      const data = `data:image/png;base64,${opts.wordmarkBase64}`
      const { width, height } = doc.getImageProperties(data)
      const h = 11, w = Math.min(70, h * (width / height))
      doc.addImage(data, 'PNG', 14, 14 - h / 2, w, h)
      drawn = true
    } catch {}
  }
  if (!drawn) {
    if (opts.logoBase64) { try { doc.addImage(`data:image/png;base64,${opts.logoBase64}`, 'PNG', 14, 7, 14, 14) } catch {} }
    else { doc.setFillColor(255, 255, 255); doc.roundedRect(14, 7, 14, 14, 3, 3, 'F'); doc.setTextColor(...BLUE); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('S', 19.2, 16.5) }
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('StockShop', 32, 16.5)
  }
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold')
  doc.setFontSize(11); doc.text(clean(p.labels.title), W - 14, 16.5, { align: 'right' })

  // Références et client
  doc.setTextColor(17, 24, 39); doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  let y = 40
  const pair = (k: string, v: string, x: number, yy: number) => { doc.setFont('helvetica', 'bold'); doc.text(clean(k), x, yy); doc.setFont('helvetica', 'normal'); doc.text(clean(v), x + 32, yy) }
  pair(p.labels.reference, p.reference, 14, y); pair(p.labels.client, p.clientName, W / 2, y); y += 6
  pair(p.labels.date, p.dateStr, 14, y); pair(p.labels.country, p.clientCountry, W / 2, y); y += 6
  pair(p.labels.validUntil, p.validUntilStr, 14, y); y += 8

  autoTable(doc, {
    startY: y,
    head: [[clean(p.labels.colItem), clean(p.labels.colDetail), clean(p.labels.colAmount)]],
    body: p.lines.map(l => [clean(l.label), clean(l.detail), clean(l.amount)]),
    foot: [[clean(p.totalLabel), '', { content: clean(p.totalAmount), styles: { halign: 'right' } }]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, lineColor: [214, 222, 235] },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [232, 240, 251], textColor: BLUE, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right', cellWidth: 45 } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 10

  // Lien de paiement
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...BLUE); doc.text(clean(p.labels.pay), 14, y); y += 6
  doc.setFont('helvetica', 'normal'); doc.setTextColor(17, 24, 39)
  const linkLines = doc.splitTextToSize(p.payUrl, W - 28)
  doc.textWithLink(linkLines[0], 14, y, { url: p.payUrl })
  if (linkLines.length > 1) doc.text(linkLines.slice(1), 14, y + 5)
  y += 6 + (linkLines.length - 1) * 5 + 4

  if (p.note) {
    doc.setFont('helvetica', 'bold'); doc.text(clean(p.labels.noteTitle), 14, y); y += 6
    doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(clean(p.note), W - 28), 14, y)
  }

  doc.setFontSize(8); doc.setTextColor(107, 114, 128)
  doc.text(clean(p.labels.footer), W / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' })
  return { doc, fileName: `StockShop - ${clean(p.labels.title)} - ${clean(p.reference)}.pdf` }
}
