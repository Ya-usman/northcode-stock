'use client'

import type { Sale, SaleItem, Shop } from '@/lib/types/database'

interface ReceiptData {
  sale: Sale & { sale_items: SaleItem[] }
  shop: Shop
  cashierName: string
  customerName?: string
}

async function buildReceiptDoc(data: ReceiptData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { sale, shop, cashierName, customerName } = data

  // Currency formatter — jsPDF Helvetica can't render ₦, use sanitizePDF
  const isFCFA = shop.currency === 'FCFA'
  const fmtAmt = (n: number) => {
    if (isFCFA) {
      const formatted = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      return sanitizePDF(`${formatted} FCFA`)
    }
    return `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  // A5 format: 148 x 210 mm
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })

  const pageWidth = 148
  const margin = 12
  let y = 14

  // ─── HEADER ──────────────────────────────────
  // Try to embed shop logo; fall back to "NC" box
  let logoLoaded = false
  if (shop.logo_url) {
    try {
      const response = await fetch(shop.logo_url)
      const blob = await response.blob()
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const ext = blob.type.includes('png') ? 'PNG' : 'JPEG'
      doc.addImage(base64, ext, margin, y, 20, 20)
      logoLoaded = true
    } catch { /* fall through to initials box */ }
  }
  if (!logoLoaded) {
    doc.setFillColor(10, 47, 110)
    doc.roundedRect(margin, y, 20, 20, 3, 3, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(shop.name.slice(0, 2).toUpperCase(), margin + 10, y + 13, { align: 'center' })
  }

  // Shop name + info
  doc.setTextColor(10, 47, 110)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(shop.name, margin + 24, y + 7)
  doc.setTextColor(80, 80, 80)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${shop.city}, ${shop.state || 'Nigeria'}`, margin + 24, y + 12)
  if (shop.whatsapp) {
    doc.text(`WhatsApp: ${shop.whatsapp}`, margin + 24, y + 17)
  }

  y += 26

  // Divider
  doc.setDrawColor(10, 47, 110)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5

  // ─── SALE INFO ────────────────────────────────
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  doc.text(`Receipt #${sale.sale_number}`, margin, y)
  doc.setFont('helvetica', 'normal')
  doc.text(
    new Date(sale.created_at).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }),
    pageWidth - margin,
    y,
    { align: 'right' }
  )
  y += 5

  doc.text(`Cashier: ${cashierName}`, margin, y)
  if (customerName) {
    doc.text(`Customer: ${customerName}`, pageWidth - margin, y, { align: 'right' })
  }
  y += 7

  // ─── ITEMS TABLE ──────────────────────────────
  // A5 usable width = 148 - 2×12 = 124mm → 38 + 20 + 34 + 32 = 124
  const items = sale.sale_items || []
  autoTable(doc, {
    startY: y,
    head: [['Item', 'Qty', 'Unit Price', 'Total']],
    body: items.map((item) => [
      item.product_name,
      item.quantity.toString(),
      fmtAmt(Number(item.unit_price)),
      fmtAmt(Number(item.subtotal)),
    ]),
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      lineColor: [220, 225, 240],
      lineWidth: 0.2,
      overflow: 'ellipsize',
    },
    headStyles: {
      fillColor: [10, 47, 110],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 8,
      overflow: 'visible',
    },
    alternateRowStyles: { fillColor: [246, 249, 255] },
    columnStyles: {
      0: { cellWidth: 38, overflow: 'ellipsize' },
      1: { cellWidth: 20, halign: 'center' },
      2: { cellWidth: 34, halign: 'right' },
      3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
    },
    // Align header text to match data alignment
    didParseCell: (data: any) => {
      if (data.section === 'head') {
        if (data.column.index === 1) data.cell.styles.halign = 'center'
        if (data.column.index === 2 || data.column.index === 3) data.cell.styles.halign = 'right'
      }
    },
  })

  y = (doc as any).lastAutoTable.finalY + 4

  // ─── TOTALS ───────────────────────────────────
  const rightCol = pageWidth - margin
  const labelCol = pageWidth - margin - 54

  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(labelCol - 5, y, rightCol, y)
  y += 4

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)

  if (Number(sale.discount) > 0) {
    doc.text('Subtotal:', labelCol, y)
    doc.text(fmtAmt(Number(sale.subtotal)), rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(220, 50, 50)
    doc.text('Discount:', labelCol, y)
    doc.text(`-${fmtAmt(Number(sale.discount))}`, rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(60, 60, 60)
  }

  if (Number(sale.tax) > 0) {
    doc.text('Tax:', labelCol, y)
    doc.text(fmtAmt(Number(sale.tax)), rightCol, y, { align: 'right' })
    y += 5
  }

  // TOTAL (large)
  doc.setLineWidth(0.5)
  doc.setDrawColor(10, 47, 110)
  doc.line(labelCol - 5, y, rightCol, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(10, 47, 110)
  doc.text('TOTAL:', labelCol, y)
  doc.text(fmtAmt(Number(sale.total)), rightCol, y, { align: 'right' })
  y += 6

  // Paid / Balance
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(22, 163, 74)
  doc.text(sanitizePDF(`Paid: ${fmtAmt(Number(sale.amount_paid))} via ${sale.payment_method}`), labelCol, y)
  y += 5

  if (Number(sale.balance) > 0) {
    doc.setTextColor(220, 38, 38)
    doc.setFont('helvetica', 'bold')
    doc.text(`Balance Due: ${fmtAmt(Number(sale.balance))}`, labelCol, y)
    y += 5
  }

  // ─── FOOTER ───────────────────────────────────
  y += 4
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text('Thank you for your business', pageWidth / 2, y, { align: 'center' })
  y += 4
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 100, 100)
  doc.text('Na gode da kasuwancin ku', pageWidth / 2, y, { align: 'center' })

  return { doc, fileName: `Receipt-${sale.sale_number}.pdf` }
}

export async function generateReceiptPDF(data: ReceiptData): Promise<void> {
  const { doc, fileName } = await buildReceiptDoc(data)
  doc.save(fileName)
}

export async function generateReceiptPDFBlob(data: ReceiptData): Promise<Blob> {
  const { doc } = await buildReceiptDoc(data)
  return doc.output('blob')
}

// Sanitize currency strings for jsPDF (Helvetica can't render ₦ or non-breaking spaces)
function sanitizePDF(value: string | number): string {
  return String(value)
    .replace(/₦/g, 'NGN ')
    .replace(/\u20a6/g, 'NGN ')
    // Fix fr-FR thin non-breaking space (U+202F) used by toLocaleString → plain space
    .replace(/\u202f/g, ' ')
    // Fix regular non-breaking space (U+00A0) → plain space
    .replace(/\u00a0/g, ' ')
}

interface DebtReceiptData {
  customerName: string
  amount: number
  method: string
  reference?: string | null
  notes?: string | null
  receivedBy: string
  shop: Shop
  appliedSales: { sale_number: string; amount: number }[]
  remainingBalance: number
}

export async function generateDebtReceiptPDF(data: DebtReceiptData): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { customerName, amount, method, reference, notes, receivedBy, shop, appliedSales, remainingBalance } = data

  const isFCFA = shop.currency === 'FCFA'
  const fmtAmt = (n: number) => {
    if (isFCFA) {
      const formatted = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      return sanitizePDF(`${formatted} FCFA`)
    }
    return `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  const pageWidth = 148
  const margin = 12
  let y = 14

  // ─── HEADER ──────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.roundedRect(margin, y, 20, 20, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('NC', margin + 10, y + 13, { align: 'center' })

  doc.setTextColor(10, 47, 110)
  doc.setFontSize(14)
  doc.text(shop.name, margin + 24, y + 7)
  doc.setTextColor(80, 80, 80)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(`${shop.city}, ${shop.state || 'Nigeria'}`, margin + 24, y + 12)
  if (shop.whatsapp) doc.text(`WhatsApp: ${shop.whatsapp}`, margin + 24, y + 17)

  y += 26

  doc.setDrawColor(10, 47, 110)
  doc.setLineWidth(0.5)
  doc.line(margin, y, pageWidth - margin, y)
  y += 6

  // ─── TITLE ───────────────────────────────────
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text('RECU DE REMBOURSEMENT', pageWidth / 2, y, { align: 'center' })
  y += 5

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80, 80, 80)
  doc.text(
    new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    pageWidth / 2, y, { align: 'center' }
  )
  y += 8

  // ─── CUSTOMER + RECEIVER ─────────────────────
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(0, 0, 0)
  doc.text(`Client: ${customerName}`, margin, y)
  doc.text(`Recu par: ${receivedBy}`, pageWidth - margin, y, { align: 'right' })
  y += 6

  const methodLabels: Record<string, string> = {
    cash: 'Especes', transfer: 'Virement', mobile_money: 'Mobile Money', paystack: 'Paystack',
  }
  doc.text(`Mode: ${methodLabels[method] || method}`, margin, y)
  if (reference) doc.text(`Ref: ${reference}`, pageWidth - margin, y, { align: 'right' })
  y += 8

  // ─── APPLIED INVOICES TABLE ───────────────────
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 80, 80)
  doc.text('FACTURES REGLEES :', margin, y)
  y += 2

  autoTable(doc, {
    startY: y,
    head: [['Facture #', 'Montant regle']],
    body: appliedSales.map(s => [`#${s.sale_number}`, fmtAmt(s.amount)]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [10, 47, 110], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 64, halign: 'right' },
    },
  })

  y = (doc as any).lastAutoTable.finalY + 5

  // ─── TOTAL + BALANCE ─────────────────────────
  const rightCol = pageWidth - margin
  const labelCol = pageWidth - margin - 70

  doc.setDrawColor(10, 47, 110)
  doc.setLineWidth(0.5)
  doc.line(labelCol - 5, y, rightCol, y)
  y += 5

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text('TOTAL PAYE :', labelCol, y)
  doc.text(fmtAmt(amount), rightCol, y, { align: 'right' })
  y += 6

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (remainingBalance > 0) {
    doc.setTextColor(220, 38, 38)
    doc.text(`Solde restant: ${fmtAmt(remainingBalance)}`, labelCol, y)
  } else {
    doc.setTextColor(22, 163, 74)
    doc.setFont('helvetica', 'bold')
    doc.text('Dette soldee integralement ✓', labelCol, y)
  }
  y += 8

  if (notes) {
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(100, 100, 100)
    doc.text(`Note: ${notes}`, margin, y)
    y += 6
  }

  // ─── FOOTER ───────────────────────────────────
  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text('Merci pour votre confiance', pageWidth / 2, y, { align: 'center' })
  y += 4
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(100, 100, 100)
  doc.text('Na gode da kasuwancin ku', pageWidth / 2, y, { align: 'center' })

  doc.save(`Remboursement-${customerName.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
}

type ReportParams = {
  shopName: string
  dateRange: string
  sections: { title: string; headers: string[]; rows: (string | number)[][] }[]
  labels?: {
    businessReport: string
    generatedBy: string
    page: string
    of: string
  }
}

async function buildReportDoc(params: ReportParams) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { shopName, dateRange, sections, labels } = params
  const lbl = {
    businessReport: labels?.businessReport ?? 'Business Report',
    generatedBy: labels?.generatedBy ?? 'Generated by StockShop',
    page: labels?.page ?? 'Page',
    of: labels?.of ?? 'of',
  }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const margin = 14
  let y = 0

  // ── HEADER BAND ──────────────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setFillColor(212, 175, 55)
  doc.rect(0, 22, pageWidth, 2, 'F')

  // App logo (logo-tab.png) — white rounded square background
  let logoLoaded = false
  try {
    const logoUrl = `${window.location.origin}/logo-icon.png`
    const res = await fetch(logoUrl)
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    // Gold outer ring
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    // White inner background
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    // Logo on top
    doc.addImage(base64, 'PNG', margin + 0.5, 3.5, 15, 15)
    logoLoaded = true
  } catch { /* fallback below */ }

  if (!logoLoaded) {
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(10, 47, 110)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text('S', margin + 8, 14, { align: 'center' })
  }

  // Title
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('StockShop', margin + 20, 12)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 210, 255)
  doc.text(lbl.businessReport, margin + 20, 18)

  // Date range (right)
  doc.setFontSize(8); doc.setTextColor(200, 210, 255)
  doc.text(dateRange, pageWidth - margin, 12, { align: 'right' })

  y = 30

  // Shop name
  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(shopName, margin, y)
  y += 3

  doc.setDrawColor(220, 225, 240); doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── SECTIONS ─────────────────────────────────────────────
  for (const section of sections) {
    doc.setFillColor(10, 47, 110)
    doc.rect(margin, y - 3.5, 3, 6, 'F')
    doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.setTextColor(10, 47, 110)
    doc.text(section.title, margin + 5, y)
    y += 3

    autoTable(doc, {
      startY: y,
      head: [section.headers.map(sanitizePDF)],
      body: section.rows.map(row => row.map(sanitizePDF)),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8.5, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: [30, 30, 30], lineColor: [230, 234, 245], lineWidth: 0.2 },
      headStyles: { fillColor: [10, 47, 110], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
      alternateRowStyles: { fillColor: [246, 248, 255] },
      columnStyles: { [section.headers.length - 1]: { halign: 'right' } },
    })

    y = (doc as any).lastAutoTable.finalY + 10
    if (y > 265) { doc.addPage(); y = 15 }
  }

  // ── FOOTER ───────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(245, 247, 252)
    doc.rect(0, 284, pageWidth, 13, 'F')
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text(`${lbl.generatedBy} — northcode-stock.vercel.app`, margin, 291)
    doc.text(`${lbl.page} ${i} ${lbl.of} ${pageCount}`, pageWidth - margin, 291, { align: 'right' })
  }

  return { doc, fileName: `Report-${shopName}-${dateRange}.pdf` }
}

export async function generateReportPDF(params: ReportParams): Promise<void> {
  const { doc, fileName } = await buildReportDoc(params)
  doc.save(fileName)
}

export async function generateReportPDFBlob(params: ReportParams): Promise<{ blob: Blob; fileName: string }> {
  const { doc, fileName } = await buildReportDoc(params)
  return { blob: doc.output('blob'), fileName }
}
