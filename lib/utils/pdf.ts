'use client'

import type { Sale, SaleItem, Shop } from '@/lib/types/database'

interface ReceiptData {
  sale: Sale & { sale_items: SaleItem[] }
  shop: Shop
  cashierName: string
  customerName?: string
}

export async function generateReceiptPDF(data: ReceiptData): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { sale, shop, cashierName, customerName } = data

  // A5 format: 148 x 210 mm
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })

  const pageWidth = 148
  const margin = 12
  let y = 14

  // ─── HEADER ──────────────────────────────────
  // NC Logo (blue square)
  doc.setFillColor(10, 47, 110) // #0A2F6E
  doc.roundedRect(margin, y, 20, 20, 3, 3, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('NC', margin + 10, y + 13, { align: 'center' })

  // Shop name + info
  doc.setTextColor(10, 47, 110)
  doc.setFontSize(14)
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
    new Date(sale.created_at).toLocaleString('en-NG', {
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
  autoTable(doc, {
    startY: y,
    head: [['Item', 'Qty', 'Unit Price', 'Total']],
    body: sale.sale_items.map((item) => [
      item.product_name,
      item.quantity.toString(),
      `₦${Number(item.unit_price).toLocaleString('en-NG')}`,
      `₦${Number(item.subtotal).toLocaleString('en-NG')}`,
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [10, 47, 110], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 28, halign: 'right' },
      3: { cellWidth: 28, halign: 'right' },
    },
  })

  y = (doc as any).lastAutoTable.finalY + 4

  // ─── TOTALS ───────────────────────────────────
  const fmt = (n: number) => `₦${n.toLocaleString('en-NG')}`
  const rightCol = pageWidth - margin
  const labelCol = pageWidth - margin - 50

  doc.setDrawColor(220, 220, 220)
  doc.setLineWidth(0.3)
  doc.line(labelCol - 5, y, rightCol, y)
  y += 4

  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(60, 60, 60)

  if (Number(sale.discount) > 0) {
    doc.text('Subtotal:', labelCol, y)
    doc.text(fmt(Number(sale.subtotal)), rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(220, 50, 50)
    doc.text(`Discount:`, labelCol, y)
    doc.text(`-${fmt(Number(sale.discount))}`, rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(60, 60, 60)
  }

  if (Number(sale.tax) > 0) {
    doc.text('Tax:', labelCol, y)
    doc.text(fmt(Number(sale.tax)), rightCol, y, { align: 'right' })
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
  doc.text(fmt(Number(sale.total)), rightCol, y, { align: 'right' })
  y += 6

  // Paid / Balance
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(22, 163, 74)
  doc.text(`Paid: ${fmt(Number(sale.amount_paid))} via ${sale.payment_method}`, labelCol, y)
  y += 5

  if (Number(sale.balance) > 0) {
    doc.setTextColor(220, 38, 38)
    doc.setFont('helvetica', 'bold')
    doc.text(`Balance Due: ${fmt(Number(sale.balance))}`, labelCol, y)
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

  // Save / open
  doc.save(`Receipt-${sale.sale_number}.pdf`)
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

export async function generateReportPDF(params: {
  shopName: string
  dateRange: string
  sections: { title: string; headers: string[]; rows: (string | number)[][] }[]
}): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { shopName, dateRange, sections } = params
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const margin = 14
  let y = 0

  // ── HEADER BAND ──────────────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 22, 'F')

  // Gold accent stripe
  doc.setFillColor(212, 175, 55)
  doc.rect(0, 22, pageWidth, 2, 'F')

  // NC logo box
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(margin, 4, 14, 14, 2, 2, 'F')
  doc.setTextColor(10, 47, 110)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.text('NC', margin + 7, 13, { align: 'center' })

  // Title
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('NorthCode Stock Manager', margin + 18, 12)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 210, 255)
  doc.text('Business Report', margin + 18, 18)

  // Date range (right)
  doc.setFontSize(8)
  doc.setTextColor(200, 210, 255)
  doc.text(dateRange, pageWidth - margin, 12, { align: 'right' })

  y = 30

  // Shop name
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(shopName, margin, y)
  y += 3

  // Thin separator
  doc.setDrawColor(220, 225, 240)
  doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── SECTIONS ─────────────────────────────────────────────
  for (const section of sections) {
    // Section title with left accent bar
    doc.setFillColor(10, 47, 110)
    doc.rect(margin, y - 3.5, 3, 6, 'F')

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(10, 47, 110)
    doc.text(section.title, margin + 5, y)
    y += 3

    autoTable(doc, {
      startY: y,
      head: [section.headers.map(sanitizePDF)],
      body: section.rows.map(row => row.map(sanitizePDF)),
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        textColor: [30, 30, 30],
        lineColor: [230, 234, 245],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [10, 47, 110],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
      },
      alternateRowStyles: {
        fillColor: [246, 248, 255],
      },
      columnStyles: {
        // Right-align columns that look like amounts (heuristic: last 1-2 columns)
        [section.headers.length - 1]: { halign: 'right' },
      },
    })

    y = (doc as any).lastAutoTable.finalY + 10

    // Add page if needed
    if (y > 265) {
      doc.addPage()
      y = 15
    }
  }

  // ── FOOTER ───────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(245, 247, 252)
    doc.rect(0, 284, pageWidth, 13, 'F')
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text('Generated by NorthCode Stock Manager — northcode-stock.vercel.app', margin, 291)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, 291, { align: 'right' })
  }

  doc.save(`Report-${shopName}-${dateRange}.pdf`)
}
