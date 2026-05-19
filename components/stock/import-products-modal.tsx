'use client'

import { useRef, useState } from 'react'
import { Upload, Download, CheckCircle2, AlertCircle, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'

interface Props {
  open: boolean
  onClose: () => void
  shopId: string
  onImported: (count: number) => void
}

const TEMPLATE_HEADERS = ['name', 'selling_price', 'buying_price', 'quantity', 'unit', 'sku', 'low_stock_threshold']
const TEMPLATE_EXAMPLE = [
  ['Coca Cola 50cl', '200', '150', '100', 'piece', '5900259145867', '20'],
  ['Sucre 1kg', '500', '380', '50', 'kg', '', '10'],
  ['Huile Végétale 1L', '900', '700', '30', 'litre', '', '5'],
]

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE]
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'modele-produits.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
  return lines.slice(1).map(line => {
    const values = line.split(',').map(v => v.replace(/^"|"$/g, '').trim())
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = values[i] ?? '' })
    return obj
  })
}

export function ImportProductsModal({ open, onClose, shopId, onImported }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ inserted: number; errors: { line: number; error: string }[] } | null>(null)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      const parsed = parseCSV(text)
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleImport = async () => {
    if (!rows.length || !shopId) return
    setImporting(true)
    try {
      const res = await fetch('/api/products/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, shop_id: shopId }),
      })
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

  const reset = () => {
    setRows([])
    setFileName('')
    setResult(null)
  }

  return (
    <PremiumDialog open={open} onOpenChange={v => { if (!v) { reset(); onClose() } }} category="Stock" title="Importer des produits" icon={<Upload className="h-4 w-4" />}>
      <PremiumDialogBody className="space-y-4">

        {/* Step 1: Download template */}
        <div className="rounded-xl border bg-muted/40 p-4 space-y-2">
          <p className="text-sm font-semibold">1 · Télécharger le modèle CSV</p>
          <p className="text-xs text-muted-foreground">Remplissez le fichier Excel/Google Sheets, puis ré-enregistrez en CSV.</p>
          <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> Télécharger le modèle
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Colonnes : <span className="font-mono">name*</span>, <span className="font-mono">selling_price*</span>, buying_price, quantity, unit, sku, low_stock_threshold
          </p>
        </div>

        {/* Step 2: Upload */}
        <div className="space-y-2">
          <p className="text-sm font-semibold">2 · Charger votre fichier CSV</p>
          {!fileName ? (
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full h-20 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Upload className="h-5 w-5" />
              <span className="text-xs">Cliquer pour choisir un fichier .csv</span>
            </button>
          ) : (
            <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">{rows.length} ligne{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}</p>
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
              Aperçu ({Math.min(rows.length, 3)} / {rows.length})
            </div>
            <div className="divide-y">
              {rows.slice(0, 3).map((row, i) => (
                <div key={i} className="px-3 py-2 text-xs flex justify-between gap-2">
                  <span className="font-medium truncate">{row.name || <span className="text-red-400">— manquant —</span>}</span>
                  <span className="text-muted-foreground shrink-0">{row.selling_price || '0'} · qté {row.quantity || '0'}</span>
                </div>
              ))}
              {rows.length > 3 && <div className="px-3 py-2 text-xs text-muted-foreground">+ {rows.length - 3} autres…</div>}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-2">
            {result.inserted > 0 && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm font-medium text-green-700">{result.inserted} produit{result.inserted > 1 ? 's' : ''} importé{result.inserted > 1 ? 's' : ''} avec succès</p>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="rounded-xl border border-red-200 overflow-hidden">
                <div className="bg-red-50 px-3 py-2 flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600">{result.errors.length} ligne{result.errors.length > 1 ? 's' : ''} ignorée{result.errors.length > 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="px-3 py-1.5 text-xs text-red-600">
                      {e.line > 0 ? `Ligne ${e.line} : ` : ''}{e.error}
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
            className="bg-blue-600 dark:bg-blue-500"
            disabled={rows.length === 0 || importing}
            onClick={handleImport}
          >
            {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Import en cours…</> : `Importer ${rows.length} produit${rows.length > 1 ? 's' : ''}`}
          </Button>
        ) : (
          <Button onClick={() => { reset(); onClose() }} className="bg-blue-600 dark:bg-blue-500">
            Fermer
          </Button>
        )}
      </PremiumDialogFooter>
    </PremiumDialog>
  )
}
