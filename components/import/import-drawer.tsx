'use client'

// Écran d'import COMMUN (produits, clients, fournisseurs) — 7 oct. 2026 :
// 1) modèle Excel prêt à remplir (onglet « Mode d'emploi », contrôles Excel) ;
// 2) fichier Excel ou CSV, lu dans le navigateur ; 3) VÉRIFICATION complète
// par le serveur avant d'importer (mêmes règles que l'import) : à importer,
// déjà présents (laissés tels quels — jamais de doublon), à corriger (raison
// en clair, fichier des lignes à corriger). Seules les lignes nouvelles sont créées.
// Textes : namespace « import » ; pour clients / fournisseurs, les textes
// propres sont dans « import.customers » / « import.suppliers » (prioritaires).

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, MinusCircle, Upload, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { AppDrawer } from '@/components/ui/app-drawer'
import { FOOTER_CANCEL_CLASS, FOOTER_PRIMARY_CLASS, FOOTER_ROW_CLASS } from '@/components/ui/premium-dialog'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { downloadOrShareBlob, isCapacitor } from '@/lib/utils/native-share'
import { withTimeout } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, PRODUCT_UNITS } from '@/lib/import/products-import'
import type { TemplateSpec, TemplateColumn } from '@/lib/import/template'

export type ImportKind = 'products' | 'customers' | 'suppliers'

interface Props {
  kind: ImportKind
  open: boolean
  onClose: () => void
  shopId: string
  onImported: (count: number) => void
}

type Status = 'new' | 'exists' | 'error' | 'ignored'
interface ServerRow { line: number; status: Status; issue?: string; params?: Record<string, string | number>; warnings: { code: string; params?: Record<string, string | number> }[] }
interface Summary { total: number; new: number; exists: number; errors: number; ignored: number; warnings: number }
type Phase = 'idle' | 'reading' | 'checking' | 'review' | 'importing' | 'done'
type Raw = Record<string, unknown>

const STATUS_STYLE: Record<Status, string> = {
  new: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
  exists: 'bg-muted text-muted-foreground',
  error: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400',
  ignored: 'bg-muted text-muted-foreground',
}
const ORDER: Record<Status, number> = { error: 0, new: 1, exists: 2, ignored: 3 }
const SHOWN_NEW = 50

// Colonnes des fiches (clients, fournisseurs) : largeur et contrôle Excel
const CONTACT_COLUMNS: Record<'customers' | 'suppliers', { key: string; width: number; required?: boolean; validation?: TemplateColumn['validation'] }[]> = {
  customers: [{ key: 'name', width: 32, required: true }, { key: 'phone', width: 22, validation: 'text' }, { key: 'city', width: 22 }, { key: 'credit_limit', width: 20, validation: 'decimal' }],
  suppliers: [{ key: 'name', width: 32, required: true }, { key: 'phone', width: 22, validation: 'text' }, { key: 'email', width: 30 }, { key: 'city', width: 22 }],
}
const ENDPOINT: Record<ImportKind, string> = { products: '/api/products/import', customers: '/api/customers/import', suppliers: '/api/suppliers/import' }

export function ImportDrawer({ kind, open, onClose, shopId, onImported }: Props) {
  const tBase = useTranslations('import')
  const tRoot = useTranslations()
  const { userShops } = useAuthContext()
  const shopName = userShops.find(s => s.id === shopId)?.name || 'StockShop'
  const fileRef = useRef<HTMLInputElement>(null)

  // Texte propre au type d'import s'il existe (« import.customers.title »), sinon le texte commun
  const own = useMemo(() => (kind === 'products' ? null : (tBase.raw(kind) as Record<string, any>)), [kind, tBase])
  const hasOwn = (key: string) => !!own && key.split('.').reduce<any>((o, k) => (o && typeof o === 'object' ? o[k] : undefined), own) !== undefined
  const t = (key: string, values?: Record<string, any>) => (hasOwn(key) ? tBase(`${kind}.${key}` as any, values) : tBase(key as any, values))
  const raw = (key: string) => (hasOwn(key) ? tBase.raw(`${kind}.${key}` as any) : tBase.raw(key as any))

  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [readError, setReadError] = useState<string | null>(null)
  const [rows, setRows] = useState<{ line: number; values: Raw }[]>([])
  const [truncated, setTruncated] = useState(false)
  const [report, setReport] = useState<{ summary: Summary; rows: ServerRow[] } | null>(null)
  const [inserted, setInserted] = useState(0)
  const [busyTemplate, setBusyTemplate] = useState(false)
  const [smallScreen, setSmallScreen] = useState(false)
  useEffect(() => { setSmallScreen(isCapacitor() || window.matchMedia('(max-width: 639px)').matches) }, [])

  const rawByLine = useMemo(() => new Map(rows.map(r => [r.line, r.values])), [rows])
  const fieldLabel = (f: string) => t(`xlsx.col.${f}.header`)
  const issueText = (r: { issue?: string; params?: Record<string, string | number> }) => (r.issue ? t(`issue.${r.issue}`, r.params) : '')
  const warningText = (w: ServerRow['warnings'][number]) => t(`warning.${w.code}`, w.params)

  // ── Modèle Excel ──────────────────────────────────────────────────────────
  const shared = () => {
    const x = (k: string) => tBase(`xlsx.${k}` as any)
    return {
      sheetGuide: x('sheet_guide'), sheetLists: x('sheet_lists'),
      guideColumnsTitle: x('guide_columns_title'), guideColumn: x('guide_column'), guideRequired: x('guide_required'), guideMeaning: x('guide_meaning'), guideExample: x('guide_example'),
      yes: x('yes'), no: x('no'), guideExamplesTitle: x('guide_examples_title'), guideExamplesNote: x('guide_examples_note'),
      guideTipsTitle: x('guide_tips_title'), validationTitle: x('validation_title'), validationNumber: x('validation_number'), validationInteger: x('validation_integer'),
    }
  }
  const buildSpec = async (): Promise<TemplateSpec> => {
    const s = shared()
    if (kind === 'products') {
      const x = (k: string) => tBase(`xlsx.${k}` as any)
      const { productsTemplateSpec } = await import('@/lib/import/products-template')
      return productsTemplateSpec({
        ...s, sheetProducts: x('sheet_products'),
        columns: Object.fromEntries(IMPORT_FIELDS.map(f => [f, { header: x(`col.${f}.header`), help: x(`col.${f}.help`), example: x(`col.${f}.example`), required: f === 'name' || f === 'selling_price' }])) as any,
        unitLabels: Object.fromEntries(PRODUCT_UNITS.map(u => [u, x(`units.${u}`)])) as any,
        guideTitle: x('guide_title'), guideIntro: x('guide_intro'), guideSteps: tBase.raw('xlsx.guide_steps') as string[],
        examples: tBase.raw('xlsx.examples') as any[], guideUnitsTitle: x('guide_units_title'), guideTips: tBase.raw('xlsx.guide_tips') as string[],
        validationUnit: x('validation_unit'),
      }, shopName)
    }
    return {
      ...s, title: `${t('xlsx.sheet_main')} — ${shopName}`, sheetMain: t('xlsx.sheet_main'),
      columns: CONTACT_COLUMNS[kind].map(c => ({ key: c.key, width: c.width, validation: c.validation, required: !!c.required, header: t(`xlsx.col.${c.key}.header`), help: t(`xlsx.col.${c.key}.help`), example: t(`xlsx.col.${c.key}.example`) })),
      guideTitle: t('xlsx.guide_title'), guideIntro: t('xlsx.guide_intro'), guideSteps: raw('xlsx.guide_steps') as string[],
      examples: raw('xlsx.examples') as Record<string, string | number>[], guideTips: raw('xlsx.guide_tips') as string[], validationList: '',
    }
  }
  const safe = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-').trim()
  const downloadTemplate = async () => {
    setBusyTemplate(true)
    try {
      const { buildImportTemplate } = await import('@/lib/import/template')
      const blob = await buildImportTemplate(await buildSpec())
      await downloadOrShareBlob(blob, `StockShop - ${safe(t('template_file_label'))} - ${safe(shopName)}.xlsx`)
    } finally { setBusyTemplate(false) }
  }
  const downloadFix = async () => {
    if (!report) return
    const { buildImportFixFile } = await import('@/lib/import/template')
    const fix = report.rows.filter(r => r.status === 'error').map(r => ({ raw: rawByLine.get(r.line) || {}, problem: `${tBase('col_line')} ${r.line} : ${issueText(r)}` }))
    const blob = await buildImportFixFile(await buildSpec(), tBase('fix_problem_header'), fix)
    await downloadOrShareBlob(blob, `StockShop - ${safe(tBase('fix_file_label'))}.xlsx`)
  }

  // ── Fichier → vérification par le serveur ────────────────────────────────
  const send = (body: object, timeout: number) => withTimeout(fetch(ENDPOINT[kind], {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), timeout)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    setFileName(file.name); setReadError(null); setReport(null); setRows([]); setPhase('reading')
    const { readImportFile } = await import('@/lib/import/read-file')
    let read: Awaited<ReturnType<typeof readImportFile>> | any
    if (kind === 'products') read = await readImportFile(file)
    else {
      const { contactHeaderField } = await import('@/lib/import/contacts-import')
      read = await readImportFile(file, { headerField: contactHeaderField(kind), required: ['name'] })
    }
    if (!read.ok) {
      setReadError(tBase(`read.${read.error}` as any, { columns: (read.missing || []).map(fieldLabel).join(', ') }))
      setPhase('idle'); return
    }
    setRows(read.rows); setTruncated(read.truncated); setPhase('checking')
    try {
      const res = await send({ shop_id: shopId, rows: read.rows, dry_run: true }, 45_000)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setReport({ summary: json.summary, rows: json.rows }); setPhase('review')
    } catch (err: any) {
      setReadError(err?.message || tBase('error_generic')); setPhase('idle')
    }
  }

  const handleImport = async () => {
    if (!report?.summary.new) return
    setPhase('importing')
    try {
      const res = await send({ shop_id: shopId, rows }, 90_000)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setInserted(json.inserted); setReport({ summary: json.summary, rows: json.rows }); setPhase('done')
      if (json.inserted > 0) onImported(json.inserted)
    } catch (err: any) {
      setReadError(err?.message || tBase('error_generic')); setPhase('review')
    }
  }

  const reset = () => { setPhase('idle'); setFileName(''); setReadError(null); setRows([]); setReport(null); setTruncated(false); setInserted(0) }
  const closeAll = () => { reset(); onClose() }

  // Lignes à afficher : à corriger d'abord, puis à importer (50 au plus), déjà présentes, ignorées
  const visible = useMemo(() => {
    if (!report) return { list: [] as ServerRow[], hiddenNew: 0 }
    const sorted = [...report.rows].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.warnings.length - a.warnings.length) || a.line - b.line)
    let n = 0, hiddenNew = 0
    const list = sorted.filter(r => { if (r.status !== 'new') return true; n++; if (n > SHOWN_NEW) { hiddenNew++; return false } return true })
    return { list, hiddenNew }
  }, [report])

  const busy = phase === 'reading' || phase === 'checking' || phase === 'importing'
  const s = report?.summary
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())
  const nameOf = (line: number) => str(rawByLine.get(line)?.name) || '—'
  /** Détail de la ligne : prix et quantité (produits), téléphone et ville (fiches) */
  const detailOf = (line: number) => {
    const v = rawByLine.get(line) || {}
    if (kind === 'products') return `${str(v.selling_price) || '—'} · ${tBase('col_qty')} ${str(v.quantity) || '0'}`
    return [str(v.phone), str(kind === 'suppliers' ? v.email : v.city)].filter(Boolean).join(' · ')
  }

  return (
    <AppDrawer
      open={open}
      onOpenChange={v => { if (!v && !busy) closeAll() }}
      title={t('title')}
      icon={<Upload className="h-4 w-4" />}
      width="lg"
      dirty={phase === 'review'}
      testId="import-drawer"
      footer={({ requestClose }) => (
        <div className={FOOTER_ROW_CLASS}>
          {phase !== 'done' ? (
            <>
              <Button type="button" variant="outline" className={FOOTER_CANCEL_CLASS} onClick={requestClose} disabled={busy}>
                {tRoot('actions.cancel')}
              </Button>
              <Button variant="stockshop" className={FOOTER_PRIMARY_CLASS} disabled={phase !== 'review' || !s?.new} loading={phase === 'importing'} onClick={handleImport} data-testid="import-submit">
                {phase === 'importing' ? tBase('importing') : phase === 'review' && !s?.new ? t('nothing_to_import') : t('import_btn', { count: s?.new ?? 0 })}
              </Button>
            </>
          ) : (
            <Button variant="stockshop" className={FOOTER_PRIMARY_CLASS} onClick={closeAll}>{tBase('close')}</Button>
          )}
        </div>
      )}
    >
      <div className="space-y-4">
        {phase !== 'done' && (<>
          {/* 1 · Modèle */}
          <section className="space-y-2 rounded-xl border bg-card p-4">
            <p className="text-sm font-semibold">{tBase('step1_title')}</p>
            <p className="text-xs text-muted-foreground">{t('step1_desc')}</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={downloadTemplate} loading={busyTemplate} data-testid="import-template">
              <FileSpreadsheet className="h-4 w-4" /> {tBase('download_template')}
            </Button>
            <p className="text-[11px] text-muted-foreground">{t('step1_required')}</p>
            {smallScreen && <p className="rounded-lg bg-stockshop-blue-muted px-3 py-2 text-xs text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300" data-testid="import-mobile-hint">{t('mobile_hint')}</p>}
          </section>

          {/* 2 · Fichier */}
          <section className="space-y-2">
            <p className="text-sm font-semibold">{tBase('step2_title')}</p>
            {!fileName ? (
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-card text-muted-foreground transition-colors hover:border-stockshop-blue hover:text-foreground dark:hover:border-blue-400">
                <Upload className="h-5 w-5" /><span className="text-xs">{tBase('drop_hint')}</span>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {phase === 'reading' ? tBase('reading') : phase === 'checking' ? tBase('checking') : rows.length ? tBase('rows_detected', { count: rows.length }) : ''}
                  </p>
                </div>
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
                  <button type="button" onClick={reset} className="text-muted-foreground hover:text-foreground" aria-label={tBase('change_file')} title={tBase('change_file')}><X className="h-4 w-4" /></button>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="hidden" onChange={handleFile} data-testid="import-file" />
            {readError && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300" data-testid="import-read-error">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />{readError}
              </p>
            )}
            {truncated && <p className="text-xs text-amber-700 dark:text-amber-400">{tBase('truncated', { max: IMPORT_MAX_ROWS })}</p>}
          </section>
        </>)}

        {/* 3 · Vérification / résultat */}
        {report && s && (
          <section className="space-y-3" data-testid="import-review">
            {phase === 'done' ? (
              <div className="space-y-1.5 rounded-xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800/60 dark:bg-green-950/40" data-testid="import-done">
                <p className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-300"><CheckCircle2 className="h-4 w-4" />{t('success', { count: inserted })}</p>
                {s.exists > 0 && <p className="text-xs text-green-800/80 dark:text-green-300/80">{t('success_exists', { count: s.exists })}</p>}
                {s.errors > 0 && <p className="text-xs text-red-700 dark:text-red-400">{tBase('success_errors', { count: s.errors })}</p>}
              </div>
            ) : (
              <p className="text-sm font-semibold">{tBase('step3_title')}</p>
            )}

            <div className="flex flex-wrap gap-1.5 text-xs font-medium" data-testid="import-summary">
              <span className={cn('rounded-full px-2.5 py-1', STATUS_STYLE.new)}>{tBase('sum_new', { count: s.new })}</span>
              {s.exists > 0 && <span className={cn('rounded-full px-2.5 py-1', STATUS_STYLE.exists)}>{t('sum_exists', { count: s.exists })}</span>}
              {s.errors > 0 && <span className={cn('rounded-full px-2.5 py-1', STATUS_STYLE.error)}>{tBase('sum_errors', { count: s.errors })}</span>}
              {s.warnings > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">{tBase('sum_warnings', { count: s.warnings })}</span>}
              {s.ignored > 0 && <span className={cn('rounded-full px-2.5 py-1', STATUS_STYLE.ignored)}>{tBase('sum_ignored', { count: s.ignored })}</span>}
            </div>
            {s.exists > 0 && phase !== 'done' && <p className="text-xs text-muted-foreground">{t('exists_note')}</p>}
            {s.errors > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                {phase !== 'done' && <p className="text-xs text-muted-foreground">{tBase('errors_note')}</p>}
                <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={downloadFix} data-testid="import-download-fix"><Download className="h-3.5 w-3.5" />{tBase('download_fix')}</Button>
              </div>
            )}

            <ul className="max-h-[45vh] divide-y overflow-y-auto rounded-xl border bg-card" data-testid="import-rows">
              {visible.list.map(r => (
                <li key={r.line} className="flex items-start gap-3 px-3 py-2 text-xs" data-status={r.status}>
                  <span className="w-10 flex-shrink-0 pt-0.5 tabular-nums text-muted-foreground">{tBase('col_line')} {r.line}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{nameOf(r.line)}</span>
                      <span className="flex-shrink-0 truncate tabular-nums text-muted-foreground">{detailOf(r.line)}</span>
                    </div>
                    {r.issue && <p className={cn('mt-0.5', r.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{issueText(r)}</p>}
                    {r.warnings.map((w, k) => <p key={k} className="mt-0.5 flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3 flex-shrink-0" />{warningText(w)}</p>)}
                  </div>
                  <span className={cn('flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[r.status])}>
                    {r.status === 'new' ? <CheckCircle2 className="h-3 w-3" /> : r.status === 'error' ? <AlertCircle className="h-3 w-3" /> : <MinusCircle className="h-3 w-3" />}
                    {t(`status_${r.status}`)}
                  </span>
                </li>
              ))}
              {visible.hiddenNew > 0 && <li className="px-3 py-2 text-xs text-muted-foreground">{t('more_rows', { count: visible.hiddenNew })}</li>}
            </ul>
          </section>
        )}
      </div>
    </AppDrawer>
  )
}
