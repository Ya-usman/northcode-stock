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
  const margin = 15
  let y = 20

  // Header
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 16, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('NorthCode Stock Manager — Report', margin, 11)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(dateRange, pageWidth - margin, 11, { align: 'right' })

  y = 22
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(shopName, margin, y)
  y += 8

  for (const section of sections) {
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(10, 47, 110)
    doc.text(section.title, margin, y)
    y += 2

    autoTable(doc, {
      startY: y,
      head: [section.headers],
      body: section.rows.map(row => row.map(String)),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [10, 47, 110], textColor: 255 },
      alternateRowStyles: { fillColor: [238, 242, 255] },
    })

    y = (doc as any).lastAutoTable.finalY + 8

    if (y > 260) {
      doc.addPage()
      y = 20
    }
  }

  doc.save(`Report-${shopName}-${dateRange}.pdf`)
}
