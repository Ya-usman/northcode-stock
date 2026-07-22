'use client'

import type { Sale, SaleItem, Shop } from '@/lib/types/database'
import { getCountry } from '@/lib/saas/countries'

interface ReceiptLabels {
  receipt: string
  cashier: string
  customer: string
  colItem: string
  colQty: string
  colUnitPrice: string
  colTotal: string
  subtotal: string
  discount: string
  tax: string
  total: string
  paid: string
  via: string
  balanceDue: string
  thankYou: string
}

interface ReceiptData {
  sale: Sale & { sale_items: SaleItem[] }
  shop: Shop
  cashierName: string
  customerName?: string
  labels?: ReceiptLabels
}

async function buildReceiptDoc(data: ReceiptData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { sale, shop, cashierName, customerName, labels } = data
  const L: ReceiptLabels = {
    receipt: labels?.receipt ?? 'Receipt',
    cashier: labels?.cashier ?? 'Cashier',
    customer: labels?.customer ?? 'Customer',
    colItem: labels?.colItem ?? 'Item',
    colQty: labels?.colQty ?? 'Qty',
    colUnitPrice: labels?.colUnitPrice ?? 'Unit Price',
    colTotal: labels?.colTotal ?? 'Total',
    subtotal: labels?.subtotal ?? 'Subtotal',
    discount: labels?.discount ?? 'Discount',
    tax: labels?.tax ?? 'Tax',
    total: labels?.total ?? 'TOTAL',
    paid: labels?.paid ?? 'Paid',
    via: labels?.via ?? 'via',
    balanceDue: labels?.balanceDue ?? 'Balance Due',
    thankYou: labels?.thankYou ?? 'Thank you for your business',
  }

  // Currency formatter — jsPDF Helvetica can't render ₦, use sanitizePDF
  const countryConfig = getCountry(shop.country)
  const isNGN = countryConfig.currency === 'NGN'
  const fmtAmt = (n: number) => {
    if (!isNGN) {
      const formatted = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      return sanitizePDF(`${formatted} ${countryConfig.currencySymbol}`)
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
    doc.text(shopInitials(shop.name), margin + 10, y + 13, { align: 'center' })
  }

  const latinName = sanitizePDF(shop.name).trim()
  const hasArabic = containsRTL(shop.name)
  const cityText = `${shop.city}, ${shop.state || 'Nigeria'}`
  doc.setTextColor(10, 47, 110)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  if (hasArabic) {
    const arabicImg = await renderArabicNameImage(shop.name, '#0a2f6e')
    if (arabicImg) doc.addImage(arabicImg, 'PNG', margin + 24, y + 1.5, 80, 6)
    else doc.text(latinName || cityText, margin + 24, y + 7)
  } else {
    doc.text(latinName || cityText, margin + 24, y + 7)
  }
  doc.setTextColor(80, 80, 80)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(cityText, margin + 24, y + 12)
  if (shop.whatsapp) doc.text(`WhatsApp: ${shop.whatsapp}`, margin + 24, y + 17)

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
  doc.text(`${L.receipt} #${sanitizeSaleNumber(sale.sale_number)}`, margin, y)
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

  doc.text(`${L.cashier}: ${cashierName}`, margin, y)
  if (customerName) {
    doc.text(`${L.customer}: ${customerName}`, pageWidth - margin, y, { align: 'right' })
  }
  y += 7

  // ─── ITEMS TABLE ──────────────────────────────
  // A5 usable width = 148 - 2×12 = 124mm → 38 + 20 + 34 + 32 = 124
  const items = sale.sale_items || []
  autoTable(doc, {
    startY: y,
    head: [[L.colItem, L.colQty, L.colUnitPrice, L.colTotal]],
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
    doc.text(`${L.subtotal}:`, labelCol, y)
    doc.text(fmtAmt(Number(sale.subtotal)), rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(220, 50, 50)
    doc.text(`${L.discount}:`, labelCol, y)
    doc.text(`-${fmtAmt(Number(sale.discount))}`, rightCol, y, { align: 'right' })
    y += 5
    doc.setTextColor(60, 60, 60)
  }

  if (Number(sale.tax) > 0) {
    doc.text(`${L.tax}:`, labelCol, y)
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
  doc.text(`${L.total}:`, labelCol, y)
  doc.text(fmtAmt(Number(sale.total)), rightCol, y, { align: 'right' })
  y += 6

  // Paid / Balance
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(22, 163, 74)
  doc.text(sanitizePDF(`${L.paid}: ${fmtAmt(Number(sale.amount_paid))} ${L.via} ${sale.payment_method}`), labelCol, y)
  y += 5

  if (Number(sale.balance) > 0) {
    doc.setTextColor(220, 38, 38)
    doc.setFont('helvetica', 'bold')
    doc.text(`${L.balanceDue}: ${fmtAmt(Number(sale.balance))}`, labelCol, y)
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
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(120, 120, 120)
  doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, y, { align: 'center' })

  return { doc, fileName: `Receipt-${sale.sale_number}.pdf` }
}

export async function generateReceiptPDF(data: ReceiptData): Promise<void> {
  const { doc, fileName } = await buildReceiptDoc(data)
  await savePDF(doc.output('blob') as Blob, fileName)
}

export async function generateReceiptPDFBlob(data: ReceiptData): Promise<Blob> {
  const { doc } = await buildReceiptDoc(data)
  return doc.output('blob')
}

// Sanitize currency strings for jsPDF (Helvetica can't render ₦ or non-breaking spaces)
function sanitizePDF(value: string | number): string {
  return String(value)
    .replace(/₦/g, 'NGN ')
    .replace(/₦/g, 'NGN ')
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')
    // Strip chars Helvetica cannot encode (Arabic, CJK, etc.) — prevents mojibake
    .replace(/[^ -ÿ]/g, '')
}

/** Safe 2-letter initials from any shop name, including Arabic */
function shopInitials(name: string): string {
  const latin = name.replace(/[^ -ÿ]/g, '').replace(/\s+/g, '').trim()
  if (latin.length >= 2) return latin.slice(0, 2).toUpperCase()
  if (latin.length === 1) return latin.toUpperCase()
  return 'SH'
}

/** True when text contains Arabic/RTL characters */
function containsRTL(text: string): boolean {
  return /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/.test(text)
}

/** Render Arabic (or any RTL) text to a PNG via canvas — browser handles shaping/RTL natively */
async function renderArabicNameImage(text: string, color: string): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 60
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.font = 'bold 36px "Segoe UI", "Noto Sans Arabic", Arial, sans-serif'
    ctx.fillStyle = color
    ctx.textBaseline = 'middle'
    ctx.direction = 'rtl'
    ctx.textAlign = 'right'
    ctx.fillText(text, 790, 30)
    return canvas.toDataURL('image/png').split(',')[1]
  } catch {
    return null
  }
}

/** Strip non-Latin1 prefix from sale numbers (e.g. Arabic prefix) for PDF display */
function sanitizeSaleNumber(saleNumber: string): string {
  const s = sanitizePDF(saleNumber).replace(/^[-\s]+/, '')
  return s || saleNumber.replace(/^.*-(\d+)$/, '$1')
}

interface DebtReceiptLabels {
  title: string
  client: string
  receivedBy: string
  mode: string
  ref: string
  invoicesSettled: string
  colInvoice: string
  colAmountSettled: string
  totalPaid: string
  remainingBalance: string
  debtCleared: string
  thankYou: string
  methodCash: string
  methodTransfer: string
  methodMobile: string
  methodPaystack: string
}

interface DebtReceiptData {
  customerName: string
  amount: number
  method: string
  methodLabel?: string
  reference?: string | null
  notes?: string | null
  receivedBy: string
  shop: Shop
  appliedSales: { sale_number: string; amount: number }[]
  remainingBalance: number
  labels?: DebtReceiptLabels
}

async function buildDebtReceiptDoc(data: DebtReceiptData) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { customerName, amount, method, methodLabel, reference, notes, receivedBy, shop, appliedSales, remainingBalance, labels } = data
  const DL: DebtReceiptLabels = {
    title: labels?.title ?? 'DEBT REPAYMENT RECEIPT',
    client: labels?.client ?? 'Client',
    receivedBy: labels?.receivedBy ?? 'Received by',
    mode: labels?.mode ?? 'Mode',
    ref: labels?.ref ?? 'Ref',
    invoicesSettled: labels?.invoicesSettled ?? 'INVOICES SETTLED:',
    colInvoice: labels?.colInvoice ?? 'Invoice #',
    colAmountSettled: labels?.colAmountSettled ?? 'Amount settled',
    totalPaid: labels?.totalPaid ?? 'TOTAL PAID:',
    remainingBalance: labels?.remainingBalance ?? 'Remaining balance:',
    debtCleared: labels?.debtCleared ?? 'Debt fully cleared ✓',
    thankYou: labels?.thankYou ?? 'Thank you for your trust',
    methodCash: labels?.methodCash ?? 'Cash',
    methodTransfer: labels?.methodTransfer ?? 'Transfer',
    methodMobile: labels?.methodMobile ?? 'Mobile Money',
    methodPaystack: labels?.methodPaystack ?? 'Paystack',
  }

  const countryConfig2 = getCountry(shop.country)
  const isNGN2 = countryConfig2.currency === 'NGN'
  const fmtAmt = (n: number) => {
    if (!isNGN2) {
      const formatted = n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      return sanitizePDF(`${formatted} ${countryConfig2.currencySymbol}`)
    }
    return `NGN ${n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' })
  const pageWidth = 148
  const margin = 12
  let y = 14

  // ─── HEADER ──────────────────────────────────
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
    doc.text(shopInitials(shop.name), margin + 10, y + 13, { align: 'center' })
  }

  const latinNameD = sanitizePDF(shop.name).trim()
  const hasArabicD = containsRTL(shop.name)
  const cityTextD = `${shop.city}, ${shop.state || 'Nigeria'}`
  doc.setTextColor(10, 47, 110)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  if (hasArabicD) {
    const arabicImgD = await renderArabicNameImage(shop.name, '#0a2f6e')
    if (arabicImgD) doc.addImage(arabicImgD, 'PNG', margin + 24, y + 1.5, 80, 6)
    else doc.text(latinNameD || cityTextD, margin + 24, y + 7)
  } else {
    doc.text(latinNameD || cityTextD, margin + 24, y + 7)
  }
  doc.setTextColor(80, 80, 80)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(cityTextD, margin + 24, y + 12)
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
  doc.text(DL.title, pageWidth / 2, y, { align: 'center' })
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
  doc.text(`${DL.client}: ${customerName}`, margin, y)
  doc.text(`${DL.receivedBy}: ${receivedBy}`, pageWidth - margin, y, { align: 'right' })
  y += 6

  const methodLabels: Record<string, string> = {
    cash: DL.methodCash, transfer: DL.methodTransfer, mobile_money: DL.methodMobile, paystack: DL.methodPaystack,
  }
  doc.text(`${DL.mode}: ${methodLabels[method] || methodLabel || method}`, margin, y)
  if (reference) doc.text(`${DL.ref}: ${reference}`, pageWidth - margin, y, { align: 'right' })
  y += 8

  // ─── APPLIED INVOICES TABLE ───────────────────
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(80, 80, 80)
  doc.text(DL.invoicesSettled, margin, y)
  y += 2

  autoTable(doc, {
    startY: y,
    head: [[DL.colInvoice, DL.colAmountSettled]],
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
  doc.text(DL.totalPaid, labelCol, y)
  doc.text(fmtAmt(amount), rightCol, y, { align: 'right' })
  y += 6

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  if (remainingBalance > 0) {
    doc.setTextColor(220, 38, 38)
    doc.text(`${DL.remainingBalance} ${fmtAmt(remainingBalance)}`, labelCol, y)
  } else {
    doc.setTextColor(22, 163, 74)
    doc.setFont('helvetica', 'bold')
    doc.text(DL.debtCleared, labelCol, y)
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
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(7.5)
  doc.setTextColor(120, 120, 120)
  doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, y, { align: 'center' })

  const fileName = `Remboursement-${customerName.replace(/\s+/g, '-')}-${Date.now()}.pdf`
  return { doc, fileName }
}

export async function generateDebtReceiptPDF(data: DebtReceiptData): Promise<void> {
  const { doc, fileName } = await buildDebtReceiptDoc(data)
  await savePDF(doc.output('blob') as Blob, fileName)
}

export async function generateDebtReceiptPDFBlob(data: DebtReceiptData): Promise<{ blob: Blob; fileName: string }> {
  const { doc, fileName } = await buildDebtReceiptDoc(data)
  return { blob: doc.output('blob') as Blob, fileName }
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

  // App logo — load via <img> element (respects SW cache, no fetch CORS issues)
  let logoLoaded = false
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => reject(new Error('logo timeout')), 6000)
      img.onload = () => {
        clearTimeout(timer)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || 512
          canvas.height = img.naturalHeight || 512
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png').split(',')[1])
        } catch (e) { reject(e) }
      }
      img.onerror = () => { clearTimeout(timer); reject(new Error('logo load error')) }
      img.src = `${window.location.origin}/logo-icon.png`
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
    doc.rect(0, 281, pageWidth, 16, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'italic')
    doc.setTextColor(160, 130, 40)
    doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, 286, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text(`${lbl.generatedBy} — stockshop.tech`, margin, 293)
    doc.text(`${lbl.page} ${i} ${lbl.of} ${pageCount}`, pageWidth - margin, 293, { align: 'right' })
  }

  return { doc, fileName: `Report-${shopName}-${dateRange}.pdf` }
}

export async function generateReportPDF(params: ReportParams): Promise<void> {
  const { doc, fileName } = await buildReportDoc(params)
  await savePDF(doc.output('blob') as Blob, fileName)
}

export async function generateReportPDFBlob(params: ReportParams): Promise<{ blob: Blob; fileName: string }> {
  const { doc, fileName } = await buildReportDoc(params)
  return { blob: doc.output('blob'), fileName }
}

export async function savePDF(blob: Blob, fileName: string): Promise<void> {
  const { isCapacitor } = await import('@/lib/utils/native-share')

  // Capacitor natif : écrit dans le cache + partage natif. Évite le fetch
  // réseau qui plante sur Android avec une erreur non-JSON.
  if (isCapacitor()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve((reader.result as string).split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    // Les slashes dans le nom (ex: dates "01/06-30/06") sont interprétés
    // comme des sous-répertoires par Filesystem → on les remplace par des tirets.
    const safeName = fileName.replace(/[/\\:*?"<>|]/g, '-')
    const result = await Filesystem.writeFile({ path: safeName, data: base64, directory: Directory.Cache })
    await Share.share({ title: safeName, url: result.uri, dialogTitle: safeName })
    return
  }

  const { downloadFile } = await import('@/lib/utils/download')
  await downloadFile(blob, fileName)
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase order (bon de commande)
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseOrderPDFItem {
  name: string
  quantity: number
  unit: string
  unitPriceLabel: string
  totalLabel: string
}

export interface PurchaseOrderPDFParams {
  shopName: string
  reference: string
  dateStr: string
  supplierName: string
  supplierPhone?: string | null
  supplierCity?: string | null
  items: PurchaseOrderPDFItem[]
  totalLabel: string
  labels?: {
    title?: string
    reference?: string
    date?: string
    supplier?: string
    colProduct?: string
    colQty?: string
    colUnitPrice?: string
    colTotal?: string
    total?: string
    generatedBy?: string
    page?: string
    of?: string
  }
}

async function buildPurchaseOrderDoc(params: PurchaseOrderPDFParams) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { shopName, reference, dateStr, supplierName, supplierPhone, supplierCity, items, totalLabel } = params
  const lbl = {
    title: params.labels?.title ?? 'BON DE COMMANDE',
    reference: params.labels?.reference ?? 'Référence',
    date: params.labels?.date ?? 'Date',
    supplier: params.labels?.supplier ?? 'Fournisseur',
    colProduct: params.labels?.colProduct ?? 'Produit',
    colQty: params.labels?.colQty ?? 'Quantité',
    colUnitPrice: params.labels?.colUnitPrice ?? 'Prix unitaire',
    colTotal: params.labels?.colTotal ?? 'Total',
    total: params.labels?.total ?? 'TOTAL',
    generatedBy: params.labels?.generatedBy ?? 'Généré par StockShop',
    page: params.labels?.page ?? 'Page',
    of: params.labels?.of ?? 'sur',
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const margin = 14
  let y = 0

  // ── HEADER BAND ── (same branding as buildReportDoc)
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setFillColor(212, 175, 55)
  doc.rect(0, 22, pageWidth, 2, 'F')

  let logoLoaded = false
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => reject(new Error('logo timeout')), 6000)
      img.onload = () => {
        clearTimeout(timer)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || 512
          canvas.height = img.naturalHeight || 512
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png').split(',')[1])
        } catch (e) { reject(e) }
      }
      img.onerror = () => { clearTimeout(timer); reject(new Error('logo load error')) }
      img.src = `${window.location.origin}/logo-icon.png`
    })
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
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

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('StockShop', margin + 20, 12)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 210, 255)
  doc.text(lbl.title, margin + 20, 18)

  doc.setFontSize(8); doc.setTextColor(200, 210, 255)
  doc.text(sanitizePDF(reference), pageWidth - margin, 12, { align: 'right' })
  doc.text(sanitizePDF(dateStr), pageWidth - margin, 18, { align: 'right' })

  y = 30

  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(sanitizePDF(shopName), margin, y)
  y += 3
  doc.setDrawColor(220, 225, 240); doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 8

  // ── SUPPLIER BLOCK ──
  doc.setFontSize(9); doc.setFont('helvetica', 'bold')
  doc.setTextColor(120, 100, 30)
  doc.text(lbl.supplier.toUpperCase(), margin, y)
  y += 5
  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 30)
  doc.text(sanitizePDF(supplierName), margin, y)
  y += 5
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.setTextColor(90, 95, 110)
  const contactLine = [supplierPhone, supplierCity].filter((v): v is string => Boolean(v)).map(sanitizePDF).join(' · ')
  if (contactLine) { doc.text(contactLine, margin, y); y += 5 }
  y += 4

  // ── ITEMS TABLE ──
  autoTable(doc, {
    startY: y,
    head: [[lbl.colProduct, lbl.colQty, lbl.colUnitPrice, lbl.colTotal].map(sanitizePDF)],
    body: items.map(it => [sanitizePDF(it.name), `${it.quantity} ${sanitizePDF(it.unit)}`, sanitizePDF(it.unitPriceLabel), sanitizePDF(it.totalLabel)]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 }, textColor: [30, 30, 30], lineColor: [230, 234, 245], lineWidth: 0.2 },
    headStyles: { fillColor: [10, 47, 110], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
  })

  y = (doc as any).lastAutoTable.finalY + 8

  doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(`${lbl.total} : ${sanitizePDF(totalLabel)}`, pageWidth - margin, y, { align: 'right' })

  // ── FOOTER ──
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(245, 247, 252)
    doc.rect(0, 281, pageWidth, 16, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'italic')
    doc.setTextColor(160, 130, 40)
    doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, 286, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text(`${lbl.generatedBy} — stockshop.tech`, margin, 293)
    doc.text(`${lbl.page} ${i} ${lbl.of} ${pageCount}`, pageWidth - margin, 293, { align: 'right' })
  }

  return { doc, fileName: `${reference}-${shopName}.pdf`.replace(/[/\\:*?"<>|]/g, '-') }
}

export async function generatePurchaseOrderPDF(params: PurchaseOrderPDFParams): Promise<void> {
  const { doc, fileName } = await buildPurchaseOrderDoc(params)
  await savePDF(doc.output('blob') as Blob, fileName)
}

export async function generatePurchaseOrderPDFBlob(params: PurchaseOrderPDFParams): Promise<{ blob: Blob; fileName: string }> {
  const { doc, fileName } = await buildPurchaseOrderDoc(params)
  return { blob: doc.output('blob') as Blob, fileName }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses report
// ─────────────────────────────────────────────────────────────────────────────

interface ExpensesReportParams {
  shopName: string
  month: string
  expenses: {
    date: string
    description: string
    category: string
    payment_method: string
    amount: number
  }[]
  catLabels: Record<string, string>
  pmLabels: Record<string, string>
  fmtAmt: (n: number) => string
  labels?: {
    title?: string
    colDate?: string
    colDesc?: string
    colCat?: string
    colPayment?: string
    colAmount?: string
    summary?: string
    grandTotal?: string
    generatedBy?: string
    page?: string
    of?: string
  }
}

async function buildExpensesReportDoc(params: ExpensesReportParams) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { shopName, month, expenses, catLabels, pmLabels, labels } = params
  // Always sanitize amounts so ₦, non-breaking spaces, etc. render correctly in Helvetica
  const fmtAmt = (n: number) => sanitizePDF(params.fmtAmt(n))
  const L = {
    title:       labels?.title       ?? 'EXPENSES REPORT',
    colDate:     labels?.colDate     ?? 'Date',
    colDesc:     labels?.colDesc     ?? 'Description',
    colCat:      labels?.colCat      ?? 'Category',
    colPayment:  labels?.colPayment  ?? 'Payment',
    colAmount:   labels?.colAmount   ?? 'Amount',
    summary:     labels?.summary     ?? 'Summary by category',
    grandTotal:  labels?.grandTotal  ?? 'GRAND TOTAL',
    generatedBy: labels?.generatedBy ?? 'Generated by StockShop',
    page:        labels?.page        ?? 'Page',
    of:          labels?.of          ?? 'of',
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const margin = 14
  let y = 0

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setFillColor(212, 175, 55)
  doc.rect(0, 22, pageWidth, 2, 'F')

  let logoLoaded = false
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => reject(new Error('timeout')), 6000)
      img.onload = () => {
        clearTimeout(timer)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || 512
          canvas.height = img.naturalHeight || 512
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png').split(',')[1])
        } catch (e) { reject(e) }
      }
      img.onerror = () => { clearTimeout(timer); reject(new Error('err')) }
      img.src = `${window.location.origin}/logo-icon.png`
    })
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    doc.addImage(base64, 'PNG', margin + 0.5, 3.5, 15, 15)
    logoLoaded = true
  } catch { /* fallback */ }

  if (!logoLoaded) {
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(10, 47, 110)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text('S', margin + 8, 14, { align: 'center' })
  }

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('StockShop', margin + 20, 12)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 210, 255)
  doc.text(L.title, margin + 20, 18)
  doc.setFontSize(8); doc.setTextColor(200, 210, 255)
  doc.text(month, pageWidth - margin, 12, { align: 'right' })

  y = 30

  // Shop name + divider
  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(sanitizePDF(shopName), margin, y)
  y += 3
  doc.setDrawColor(220, 225, 240); doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── Expenses table ───────────────────────────────────────────────────────
  // A4 usable = 182mm → 22 + 58 + 30 + 28 + 44 = 182
  doc.setFillColor(10, 47, 110)
  doc.rect(margin, y - 3.5, 3, 6, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(`${L.title} — ${month}`, margin + 5, y)
  y += 3

  autoTable(doc, {
    startY: y,
    head: [[L.colDate, L.colDesc, L.colCat, L.colPayment, L.colAmount]],
    body: expenses.map(e => [
      new Date(e.date + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      sanitizePDF(e.description),
      sanitizePDF(catLabels[e.category] ?? e.category),
      sanitizePDF(pmLabels[e.payment_method] ?? e.payment_method),
      fmtAmt(e.amount),
    ]),
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 },
      textColor: [30, 30, 30],
      lineColor: [230, 234, 245],
      lineWidth: 0.2,
      overflow: 'ellipsize',
    },
    headStyles: { fillColor: [10, 47, 110], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 58, overflow: 'ellipsize' },
      2: { cellWidth: 30 },
      3: { cellWidth: 28 },
      4: { cellWidth: 44, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'head' && data.column.index === 4) data.cell.styles.halign = 'right'
    },
  })

  y = (doc as any).lastAutoTable.finalY + 10
  if (y > 255) { doc.addPage(); y = 15 }

  // ── Summary by category ──────────────────────────────────────────────────
  const totals: Record<string, number> = {}
  let grand = 0
  for (const e of expenses) {
    totals[e.category] = (totals[e.category] ?? 0) + e.amount
    grand += e.amount
  }

  doc.setFillColor(10, 47, 110)
  doc.rect(margin, y - 3.5, 3, 6, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(L.summary, margin + 5, y)
  y += 3

  const summaryBody: any[][] = Object.entries(totals).map(([cat, amt]) => [
    sanitizePDF(catLabels[cat] ?? cat),
    fmtAmt(amt),
  ])
  summaryBody.push([L.grandTotal, fmtAmt(grand)])

  autoTable(doc, {
    startY: y,
    head: [[L.colCat, L.colAmount]],
    body: summaryBody,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: [30, 30, 30], lineColor: [230, 234, 245], lineWidth: 0.2 },
    headStyles: { fillColor: [10, 47, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: {
      0: { cellWidth: 100 },
      1: { cellWidth: 82, halign: 'right' },
    },
    didParseCell: (data: any) => {
      if (data.section === 'head' && data.column.index === 1) data.cell.styles.halign = 'right'
      if (data.section === 'body' && data.row.index === summaryBody.length - 1) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.textColor = [10, 47, 110]
        data.cell.styles.fillColor = [235, 240, 255]
      }
    },
  })

  // ── Footer on every page ─────────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(245, 247, 252)
    doc.rect(0, 281, pageWidth, 16, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'italic')
    doc.setTextColor(160, 130, 40)
    doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, 286, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text(`${L.generatedBy} — stockshop.tech`, margin, 293)
    doc.text(`${L.page} ${i} ${L.of} ${pageCount}`, pageWidth - margin, 293, { align: 'right' })
  }

  const safeMonth = month.replace(/\s+/g, '-')
  const safeName  = sanitizePDF(shopName).replace(/\s+/g, '-')
  return { doc, fileName: `Depenses-${safeName}-${safeMonth}.pdf` }
}

export async function generateExpensesReportPDF(params: ExpensesReportParams): Promise<void> {
  const { doc, fileName } = await buildExpensesReportDoc(params)
  await savePDF(doc.output('blob') as Blob, fileName)
}

// ─────────────────────────────────────────────────────────────────────────────
// Sales report
// ─────────────────────────────────────────────────────────────────────────────

interface SalesReportSale {
  date: string
  sale_number: string
  customer: string
  total: number
  amount_paid: number
  payment_method: string
  payment_status: string
  sale_status: string
}

interface SalesReportParams {
  shopName: string
  period: string
  sales: SalesReportSale[]
  pmLabels: Record<string, string>
  statusLabels: Record<string, string>
  fmtAmt: (n: number) => string
  // Cash actually collected during the period, sourced from the payments
  // ledger (paid_at) by the caller — NOT recomputed here from
  // sales.amount_paid, which is a running total keyed to the sale's
  // created_at and gets bumped retroactively by later debt repayments (the
  // same fix already applied to the on-screen "Encaissé" figure). Falls back
  // to the old (less accurate) sales.amount_paid sum if the caller omits it.
  totalCollected?: number
  labels?: {
    title?: string
    colDate?: string
    colSale?: string
    colClient?: string
    colTotal?: string
    colPaid?: string
    colMethod?: string
    colStatus?: string
    summary?: string
    totalSales?: string
    totalRevenue?: string
    generatedBy?: string
    page?: string
    of?: string
  }
}

async function buildSalesReportDoc(params: SalesReportParams) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const { shopName, period, sales, pmLabels, statusLabels, labels, totalCollected } = params
  const fmt = (n: number) => sanitizePDF(params.fmtAmt(n))

  const L = {
    title:       labels?.title       ?? 'SALES REPORT',
    colDate:     labels?.colDate     ?? 'Date',
    colSale:     labels?.colSale     ?? '#Sale',
    colClient:   labels?.colClient   ?? 'Client',
    colTotal:    labels?.colTotal    ?? 'Total',
    colPaid:     labels?.colPaid     ?? 'Paid',
    colMethod:   labels?.colMethod   ?? 'Method',
    colStatus:   labels?.colStatus   ?? 'Status',
    summary:     labels?.summary     ?? 'Summary',
    totalSales:  labels?.totalSales  ?? 'Sales count',
    totalRevenue:labels?.totalRevenue ?? 'Total revenue',
    generatedBy: labels?.generatedBy ?? 'Generated by StockShop',
    page:        labels?.page        ?? 'Page',
    of:          labels?.of          ?? 'of',
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const margin = 14
  let y = 0

  // ── Header band ──────────────────────────────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setFillColor(212, 175, 55)
  doc.rect(0, 22, pageWidth, 2, 'F')

  let logoLoaded = false
  try {
    const base64 = await new Promise<string>((resolve, reject) => {
      const img = new Image()
      const timer = setTimeout(() => reject(new Error('timeout')), 6000)
      img.onload = () => {
        clearTimeout(timer)
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth || 512
          canvas.height = img.naturalHeight || 512
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve(canvas.toDataURL('image/png').split(',')[1])
        } catch (e) { reject(e) }
      }
      img.onerror = () => { clearTimeout(timer); reject(new Error('err')) }
      img.src = `${window.location.origin}/logo-icon.png`
    })
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    doc.addImage(base64, 'PNG', margin + 0.5, 3.5, 15, 15)
    logoLoaded = true
  } catch { /* fallback */ }

  if (!logoLoaded) {
    doc.setFillColor(212, 175, 55)
    doc.roundedRect(margin - 1, 2, 18, 18, 2.5, 2.5, 'F')
    doc.setFillColor(10, 47, 110)
    doc.roundedRect(margin, 3, 16, 16, 2, 2, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text('S', margin + 8, 14, { align: 'center' })
  }

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  doc.text('StockShop', margin + 20, 12)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.setTextColor(200, 210, 255)
  doc.text(L.title, margin + 20, 18)
  doc.setFontSize(8); doc.setTextColor(200, 210, 255)
  doc.text(period, pageWidth - margin, 12, { align: 'right' })

  y = 30

  doc.setFontSize(14); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(sanitizePDF(shopName), margin, y)
  y += 3
  doc.setDrawColor(220, 225, 240); doc.setLineWidth(0.3)
  doc.line(margin, y, pageWidth - margin, y)
  y += 7

  // ── Section title ────────────────────────────────────────────────────────
  doc.setFillColor(10, 47, 110)
  doc.rect(margin, y - 3.5, 3, 6, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(`${L.title} — ${period}`, margin + 5, y)
  y += 3

  // ── Sales table ──────────────────────────────────────────────────────────
  // A4 usable = 182mm → 22 + 26 + 32 + 32 + 30 + 20 + 20 = 182
  autoTable(doc, {
    startY: y,
    head: [[L.colDate, L.colSale, L.colClient, L.colTotal, L.colPaid, L.colMethod, L.colStatus]],
    body: sales.map(s => [
      new Date(s.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }),
      sanitizePDF(s.sale_number),
      sanitizePDF(s.customer),
      fmt(s.total),
      fmt(s.amount_paid),
      sanitizePDF(pmLabels[s.payment_method] ?? s.payment_method),
      sanitizePDF(statusLabels[s.payment_status] ?? s.payment_status),
    ]),
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2, bottom: 2, left: 2.5, right: 2.5 },
      textColor: [30, 30, 30],
      lineColor: [230, 234, 245],
      lineWidth: 0.2,
      overflow: 'ellipsize',
    },
    headStyles: { fillColor: [10, 47, 110], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [246, 248, 255] },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 26 },
      2: { cellWidth: 36, overflow: 'ellipsize' },
      3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 20 },
      6: { cellWidth: 18 },
    },
    didParseCell: (data: any) => {
      if (data.section === 'head' && (data.column.index === 3 || data.column.index === 4)) {
        data.cell.styles.halign = 'right'
      }
    },
  })

  y = (doc as any).lastAutoTable.finalY + 10
  if (y > 255) { doc.addPage(); y = 15 }

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalRevenue = totalCollected ?? sales.filter(s => s.sale_status === 'active').reduce((s, v) => s + v.amount_paid, 0)
  const activeSales  = sales.filter(s => s.sale_status === 'active').length
  const cancelled    = sales.length - activeSales

  doc.setFillColor(10, 47, 110)
  doc.rect(margin, y - 3.5, 3, 6, 'F')
  doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.setTextColor(10, 47, 110)
  doc.text(L.summary, margin + 5, y)
  y += 3

  const summaryRows: any[][] = [
    [L.totalSales, `${activeSales}`],
    ...(cancelled > 0 ? [[`${cancelled > 0 ? `Annulées` : ''}`, `${cancelled}`]] : []),
    [L.totalRevenue, fmt(totalRevenue)],
  ]

  autoTable(doc, {
    startY: y,
    body: summaryRows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }, textColor: [30, 30, 30] },
    columnStyles: {
      0: { cellWidth: 100, fontStyle: 'bold', textColor: [80, 80, 80] },
      1: { cellWidth: 82, halign: 'right', fontStyle: 'bold', textColor: [10, 47, 110] },
    },
    didParseCell: (data: any) => {
      if (data.section === 'body' && data.row.index === summaryRows.length - 1) {
        data.cell.styles.fillColor = [235, 240, 255]
        data.cell.styles.fontSize = 10
      }
    },
  })

  // ── Footer ────────────────────────────────────────────────────────────────
  const pageCount = (doc as any).internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFillColor(245, 247, 252)
    doc.rect(0, 281, pageWidth, 16, 'F')
    doc.setFontSize(6.5); doc.setFont('helvetica', 'italic')
    doc.setTextColor(160, 130, 40)
    doc.text('Manage smarter. Sell faster. Grow bigger.', pageWidth / 2, 286, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.setTextColor(140, 150, 170)
    doc.text(`${L.generatedBy} — stockshop.tech`, margin, 293)
    doc.text(`${L.page} ${i} ${L.of} ${pageCount}`, pageWidth - margin, 293, { align: 'right' })
  }

  const safePeriod = period.replace(/\s+/g, '-')
  const safeName   = sanitizePDF(shopName).replace(/\s+/g, '-')
  return { doc, fileName: `Ventes-${safeName}-${safePeriod}.pdf` }
}

export async function generateSalesReportPDF(params: SalesReportParams): Promise<void> {
  const { doc, fileName } = await buildSalesReportDoc(params)
  await savePDF(doc.output('blob') as Blob, fileName)
}
