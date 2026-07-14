'use client'

import { useRef, useState } from 'react'
import { Upload, Download, CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { useTranslations } from 'next-intl'
import { downloadOrShareCSV } from '@/lib/utils/native-share'
import { withTimeout } from '@/lib/utils/with-timeout'

interface Props {
  open: boolean
  onClose: () => void
  shopId: string
  onImported: (count: number) => void
}

// Maps any language header variant → internal field name
const HEADER_ALIASES: Record<string, string> = {
  // internal keys (backward-compat)
  name: 'name', selling_price: 'selling_price', buying_price: 'buying_price',
  quantity: 'quantity', unit: 'unit', sku: 'sku',
  low_stock_threshold: 'low_stock_threshold',
  // French
  'nom du produit *': 'name', 'nom du produit': 'name',
  'prix de vente *': 'selling_price', 'prix de vente': 'selling_price',
  "prix d'achat": 'buying_price',
  'quantité': 'quantity', 'quantite': 'quantity',
  'unité (piece, kg, litre…)': 'unit', 'unité': 'unit', 'unite': 'unit',
  'sku / code-barres': 'sku', 'code-barres': 'sku',
  'seuil stock faible': 'low_stock_threshold',
  // English
  'product name *': 'name', 'product name': 'name',
  'selling price *': 'selling_price', 'selling price': 'selling_price',
  'buying price': 'buying_price',
  'unit (piece, kg, litre…)': 'unit',
  'sku / barcode': 'sku', 'barcode': 'sku',
  'low stock threshold': 'low_stock_threshold',
  // Hausa
  'suna *': 'name', 'suna': 'name',
  'farashin siyarwa *': 'selling_price', 'farashin siyarwa': 'selling_price',
  'farashin saya': 'buying_price',
  'yawa': 'quantity',
  'naúi (piece, kg, litre…)': 'unit', 'naúi': 'unit', 'naui': 'unit',
  'lambar kaya': 'sku',
  'ƙananan hannun kaya': 'low_stock_threshold', 'ƙananan hanawa': 'low_stock_threshold',
}

// Proper CSV line parser that handles quoted fields and escaped quotes
function parseCSVLine(line: string, sep: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (line.slice(i, i + sep.length) === sep && !inQuotes) {
      fields.push(current); current = ''; i += sep.length - 1
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

function parseCSV(text: string): Record<string, string>[] {
  // Strip UTF-8 BOM if present
  const cleaned = text.replace(/^﻿/, '').trim()
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  // Auto-detect separator: semicolons are common in French/African Excel locales
  const firstLine = lines[0]
  const sep = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ','

  const rawHeaders = parseCSVLine(firstLine, sep)
  const headers = rawHeaders.map(h => {
    const normalized = h.trim().toLowerCase()
    return HEADER_ALIASES[normalized] ?? normalized
  })

  return lines.slice(1).map(line => {
    const values = parseCSVLine(line, sep)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (values[i] ?? '').trim() })
    return obj
  }).filter(row => Object.values(row).some(v => v !== ''))
}

export function ImportProductsModal({ open, onClose, shopId, onImported }: Props) {
  const t = useTranslations('import')
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; errors: { line: number; error: string }[] } | null>(null)

  const downloadTemplate = async () => {
    const headers = [
      t('col_name'), t('col_selling_price'), t('col_buying_price'),
      t('col_quantity'), t('col_unit'), t('col_sku'),
      t('col_threshold'),
    ]
    const examples = [
      [t('ex_name1'), '200', '150', '100', 'piece', '5900259145867', '20'],
      [t('ex_name2'), '500', '380', '50', 'kg', '', '10'],
      [t('ex_name3'), '900', '700', '30', 'litre', '', '5'],
    ]
    const rows = [headers, ...examples]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    await downloadOrShareCSV(csv, t('template_filename'))
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setRows(parseCSV(text))
    }
    reader.readAsText(file, 'utf-8')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleImport = async () => {
    if (!rows.length || !shopId) return
    setImporting(true)
    try {
      const res = await withTimeout(fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, shop_id: shopId }),
      }), 45_000) // import de fichier CSV volumineux — plus long que le défaut
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setResult(json)
      if (json.inserted > 0) onImported(json.inserted)
    } catch (err: any) {
      setResult({ inserted: 0, errors: [{ line: 0, error: err.message }] })
    } finally {
      setImporting(false)
    }
  }

  const reset = () => { setRows([]); setFileName(''); setResult(null) }

  return (
    <PremiumDialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }} category="Stock" title={t('title')} icon={<Upload className="h-4 w-4" />}>
      <PremiumDialogBody className="space-y-4">

        {/* Step 1 */}
        <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
          <p className="text-sm font-semibold">{t('step1_title')}</p>
          <p className="text-xs text-muted-foreground">{t('step1_desc')}</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> {t('download_template')}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t('step1_required')}</p>
        </div>

        {/* Step 2 */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('step2_title')}</p>
          {!fileName ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full h-20 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Upload className="h-5 w-5" />
              <span className="text-xs">{t('drop_hint')}</span>
            </button>
          ) : (
            <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">{t('rows_detected', { count: rows.length })}</p>
              </div>
              <button onClick={reset} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        </div>

        {/* Preview */}
        {rows.length > 0 && !result && (
          <div className="rounded-xl border overflow-hidden">
            <div className="bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t('preview_title')} ({Math.min(rows.length, 3)} / {rows.length})
            </div>
            <div className="divide-y">
              {rows.slice(0, 3).map((row, i) => (
                <div key={i} className="px-3 py-2 text-xs flex justify-between gap-2">
                  <span className="font-medium truncate">{row.name || <span className="text-red-400">— manquant —</span>}</span>
                  <span className="text-muted-foreground shrink-0">{row.selling_price || '0'} · qté {row.quantity || '0'}</span>
                </div>
              ))}
              {rows.length > 3 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t('preview_more', { count: rows.length - 3 })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-2">
            {result.inserted > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-700">{t('success', { count: result.inserted })}</p>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-red-200 overflow-hidden">
                <div className="bg-red-50 px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600">{t('errors_title', { count: result.errors.length })}</span>
                </div>
                <div className="divide-y max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs text-red-600">
                      {e.line > 0 ? t('line_error', { line: e.line, error: e.error }) : e.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </PremiumDialogBody>
      <PremiumDialogFooter onCancel={() => { reset(); onClose() }}>
        {!result ? (
          <Button
            className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light"
            disabled={rows.length === 0 || importing}
            onClick={handleImport}
          >
            {importing
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {t('importing')}</>
              : t('import_btn', { count: rows.length })}
          </Button>
        ) : (
          <Button onClick={() => { reset(); onClose() }} className="flex-1 h-11 rounded-xl font-semibold bg-stockshop-blue hover:bg-stockshop-blue-light">
            {t('close')}
          </Button>
        )}
      </PremiumDialogFooter>
    </PremiumDialog>
  )
}
