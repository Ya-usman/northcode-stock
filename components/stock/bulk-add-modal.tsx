'use client'

import { useState, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { Plus, Trash2, CheckCircle2, Camera, AlertCircle, AlertTriangle, Info, PencilLine, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormDrawer } from '@/components/ui/form-drawer'
import { withTimeout, friendlyNetworkError } from '@/lib/utils/with-timeout'
import { cn } from '@/lib/utils/cn'
import { PRODUCT_UNITS, SKU_MAX_LENGTH, IMPORT_MAX_ROWS } from '@/lib/import/products-import'

const BarcodeScanner = dynamic(
  () => import('@/components/stock/barcode-scanner').then(m => ({ default: m.BarcodeScanner })),
  { ssr: false, loading: () => <div className="h-16 animate-pulse rounded-xl bg-muted" /> }
)

// Ajout rapide de produits (lot 5 de l'harmonisation, 30 oct. 2026 ; lot B des ajouts, 1er nov. 2026). Mêmes règles
// que l'import Excel (route /api/products/import, source « quick_add ») :
//  1. « Vérifier » : contrôle par le serveur SANS écriture (dry_run) ; chaque ligne reçoit son résultat (prête, déjà
//     en stock, à corriger) et ses remarques (achat > vente, péremption passée, code-barres non standard) ;
//  2. une ligne à corriger bloque l'enregistrement ; des remarques ou des lignes déjà en stock demandent confirmation ;
//  3. bilan final : produits ajoutés (« Compléter la fiche ») et lignes non ajoutées avec leur raison, jamais perdues.
// Simple d'abord : nom et prix suffisent ; les champs facultatifs (code-barres, catégorie, péremption) sont repliés
// derrière « Plus de champs » (choix gardé sur l'appareil), et s'ouvrent seuls si la vérification y signale un problème.
// Ordinateur : une ligne par produit (+ une ligne de champs facultatifs). Téléphone : une carte par produit.

interface RowResult {
  status: 'new' | 'exists' | 'error' | 'ignored'
  issue?: string
  params?: Record<string, string | number>
  warnings: { code: string; params?: Record<string, string | number> }[]
  product_id?: string
}

interface Row {
  id: number
  name: string
  selling_price: string
  buying_price: string
  quantity: string
  unit: string
  sku: string
  /** '' = catégorie générale (en haut) */
  category_id: string
  expiry_date: string
  result?: RowResult
}

interface Props {
  open: boolean
  onClose: () => void
  shopId: string
  /** « Boutique : Akwa » — boutique qui reçoit les produits, rappelée au-dessus du titre (plusieurs boutiques) */
  shopLabel?: string
  currency: string
  fullRights: boolean
  /** Catégories de la boutique qui reçoit les produits */
  categories?: { id: string; name: string }[]
  onSaved: (count: number) => void
  /** « Compléter la fiche » d'un produit créé */
  onComplete?: (productId: string) => void
}

const NONE = '__none__'
const MORE_KEY = 'bulk_add_more_fields'
// Problèmes portant sur un champ facultatif : les champs facultatifs sont alors affichés
const OPTIONAL_ISSUES = new Set(['sku_damaged', 'sku_too_long', 'sku_invalid_barcode', 'exists_sku', 'invalid_category', 'invalid_expiry_date'])
let nextId = 1
const newRow = (): Row => ({ id: nextId++, name: '', selling_price: '', buying_price: '', quantity: '0', unit: 'piece', sku: '', category_id: '', expiry_date: '' })
const touched = (r: Row) => !!(r.name.trim() || r.selling_price || r.buying_price || (r.quantity && r.quantity !== '0') || r.sku.trim() || r.expiry_date)

export function BulkAddModal({ open, onClose, shopId, shopLabel, currency, fullRights, categories = [], onSaved, onComplete }: Props) {
  const t = useTranslations('bulk_add')
  const tImport = useTranslations('import')
  const tActions = useTranslations('actions')
  const unitLabel = useUnitLabel()
  const [rows, setRows] = useState<Row[]>([newRow()])
  const [globalCategory, setGlobalCategory] = useState('')
  const [phase, setPhase] = useState<'edit' | 'confirm' | 'done'>('edit')
  const [busy, setBusy] = useState<'check' | 'save' | null>(null)
  const [localErrors, setLocalErrors] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [recap, setRecap] = useState<{ created: { id: string; name: string }[]; notAdded: Row[] } | null>(null)
  const [scanRow, setScanRow] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const lastInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { try { setMore(localStorage.getItem(MORE_KEY) === '1') } catch {} }, [])
  const toggleMore = (v: boolean) => { setMore(v); if (!v) setScanRow(null); try { localStorage.setItem(MORE_KEY, v ? '1' : '0') } catch {} }

  const addRow = () => {
    setRows(r => [...r, newRow()])
    setTimeout(() => lastInputRef.current?.focus(), 50)
  }
  const removeRow = (id: number) => { setRows(r => r.length > 1 ? r.filter(row => row.id !== id) : r); setPhase('edit') }
  // Toute modification d'une ligne efface son résultat : il faudra vérifier à nouveau
  const update = (id: number, field: keyof Row, value: string) => {
    setRows(r => r.map(row => row.id === id ? { ...row, [field]: value, result: undefined } : row))
    setLocalErrors(e => { const n = { ...e }; delete n[id]; return n })
    setError(null); setPhase('edit')
  }

  const filled = rows.filter(touched)
  // Ligne n du serveur = position dans les lignes remplies (1, 2, 3…)
  const payload = (list: Row[]) => list.map((row, i) => ({
    line: i + 1,
    category_id: row.category_id || globalCategory || null,
    values: {
      name: row.name, selling_price: row.selling_price, quantity: row.quantity || '0', unit: row.unit,
      sku: row.sku.trim() || null, expiry_date: Number(row.quantity) > 0 && row.expiry_date ? row.expiry_date : null,
      ...(fullRights ? { buying_price: row.buying_price } : {}),
    },
  }))

  const call = async (list: Row[], dryRun: boolean) => {
    const res = await withTimeout(fetch('/api/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_id: shopId, source: 'quick_add', dry_run: dryRun, rows: payload(list) }),
    }), dryRun ? 30_000 : 60_000)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error || t('error'))
    // Jamais « tout est bon » sans le résultat de CHAQUE ligne (réponse vide ou incomplète = arrêt, rien enregistré)
    if (!Array.isArray(json.rows) || json.rows.length !== list.length) throw new Error(t('error'))
    const byLine = new Map<number, RowResult>((json.rows || []).map((r: any) => [r.line, { status: r.status, issue: r.issue, params: r.params, warnings: r.warnings || [], product_id: r.product_id }]))
    return { list: list.map((row, i) => ({ ...row, result: byLine.get(i + 1) })), inserted: Number(json.inserted) || 0 }
  }

  // 1. Vérifier (aucune écriture)
  const check = async () => {
    const errs: Record<number, string> = {}
    for (const row of filled) if (!row.name.trim()) errs[row.id] = t('name_required')
    setLocalErrors(errs); setError(null)
    if (Object.keys(errs).length || !filled.length) return
    if (filled.length > IMPORT_MAX_ROWS) { setError(t('too_many', { max: IMPORT_MAX_ROWS })); return }
    setBusy('check')
    try {
      const { list } = await call(filled, true)
      setRows(list)
      if (list.some(r => r.result?.issue && OPTIONAL_ISSUES.has(r.result.issue))) toggleMore(true)
      const blocking = list.some(r => r.result?.status === 'error')
      const remarks = list.some(r => r.result && (r.result.status !== 'new' || r.result.warnings.length))
      if (blocking) { setPhase('edit'); return }
      if (remarks) { setPhase('confirm'); return }
      await save(list)
    } catch (e: any) {
      setError(friendlyNetworkError(e, t('error')))
    } finally {
      setBusy(b => (b === 'check' ? null : b))
    }
  }

  // 2. Enregistrer : seules les lignes prêtes sont créées ; le reste est rendu dans le bilan
  const save = async (list: Row[]) => {
    setBusy('save')
    try {
      const { list: after, inserted } = await call(list, false)
      const created = after.filter(r => r.result?.status === 'new' && r.result.product_id).map(r => ({ id: r.result!.product_id!, name: r.name.replace(/\s+/g, ' ').trim() }))
      const notAdded = after.filter(r => !(r.result?.status === 'new' && r.result.product_id))
      setRecap({ created, notAdded })
      setPhase('done')
      if (inserted > 0) onSaved(inserted)
    } catch (e: any) {
      setError(friendlyNetworkError(e, t('error')))
    } finally {
      setBusy(null)
    }
  }

  const reset = () => {
    setRows([newRow()]); setLocalErrors({}); setError(null); setRecap(null); setPhase('edit'); setScanRow(null)
  }
  // Bilan : reprendre seulement les lignes non ajoutées, avec leur raison affichée
  const fixRemaining = () => {
    setRows(recap && recap.notAdded.length ? recap.notAdded : [newRow()])
    setRecap(null); setPhase('edit')
  }
  const handleClose = () => { reset(); setGlobalCategory(''); onClose() }

  const ready = rows.filter(r => r.result?.status === 'new').length
  const toFix = rows.filter(r => r.result?.status === 'error').length + Object.keys(localErrors).length
  const issueText = (r: RowResult) => r.issue ? tImport(`issue.${r.issue}` as any, r.params as any) : ''
  const done = phase === 'done'

  // Ordinateur : colonnes du tableau ; téléphone : carte à 2 colonnes
  const desktopCols = fullRights ? 'sm:grid-cols-[minmax(0,1fr)_144px_112px_80px_128px_40px]' : 'sm:grid-cols-[minmax(0,1fr)_144px_80px_128px_40px]'
  const fieldLabel = 'mb-1 block text-xs font-medium text-muted-foreground sm:hidden'
  const smallLabel = 'mb-1 block text-xs font-medium text-muted-foreground'

  return (
    <FormDrawer
      open={open}
      onOpenChange={v => { if (!v) handleClose() }}
      category={shopLabel}
      title={t('title')}
      icon={<Plus className="h-4 w-4" />}
      width="xl"
      testId="bulk-add-drawer"
      dirty={!done && rows.some(touched)}
      onSubmit={done ? reset : phase === 'confirm' ? () => save(rows.filter(touched)) : check}
      submitting={busy !== null}
      submitLabel={done ? t('add_more') : phase === 'confirm' ? t('confirm_button', { count: ready }) : t('check_button', { count: filled.length })}
      submittingLabel={busy === 'check' ? t('checking') : t('saving')}
      submitDisabled={!done && (filled.length === 0 || (phase === 'confirm' && ready === 0))}
      submitIcon={done ? <Plus className="h-4 w-4" /> : undefined}
      cancelLabel={done ? tActions('close') : undefined}
      error={error}
      footerExtra={!done && (phase === 'confirm' || toFix > 0) ? (
        <p className={cn('flex items-start gap-2 text-sm', toFix > 0 ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300')} data-testid="bulk-add-notice">
          {toFix > 0 ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          {toFix > 0 ? t('fix_notice', { count: toFix }) : t('confirm_notice', { count: ready })}
        </p>
      ) : undefined}
    >
      {done && recap ? (
        <div className="space-y-5" data-testid="bulk-add-done">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className={cn('h-10 w-10', recap.created.length ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground')} />
            <p className="text-lg font-semibold">{t('added_count', { count: recap.created.length })}</p>
            {recap.notAdded.length > 0 && <p className="text-sm text-muted-foreground">{t('not_added_count', { count: recap.notAdded.length })}</p>}
          </div>
          {recap.created.length > 0 && (
            <ul className="divide-y rounded-lg border" data-testid="bulk-add-created">
              {recap.created.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{p.name}</span>
                  {onComplete && (
                    <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5" onClick={() => { const id = p.id; handleClose(); onComplete(id) }}>
                      <PencilLine className="h-4 w-4" />{t('complete')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {recap.notAdded.length > 0 && (
            <div className="space-y-2">
              <ul className="divide-y rounded-lg border" data-testid="bulk-add-not-added">
                {recap.notAdded.map(r => (
                  <li key={r.id} className="px-3 py-2 text-sm">
                    <p className="truncate font-medium">{r.name}</p>
                    <p className="text-xs text-muted-foreground">{r.result ? issueText(r.result) : t('error')}</p>
                  </li>
                ))}
              </ul>
              <Button variant="outline" className="h-10 w-full" onClick={fixRemaining} data-testid="bulk-add-fix">{t('fix_remaining')}</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-sm text-muted-foreground" data-testid="bulk-add-intro">{t('intro')}</p>
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 self-start" aria-pressed={more} onClick={() => toggleMore(!more)} data-testid="bulk-add-more">
              <SlidersHorizontal className="h-4 w-4" />{more ? t('less_fields') : t('more_fields')}
            </Button>
          </div>
          {more && categories.length > 0 && (
            <div className="max-w-xs">
              <label className={smallLabel} htmlFor="bulk-add-category">{t('category_all')}</label>
              <Select value={globalCategory || NONE} onValueChange={v => { setGlobalCategory(v === NONE ? '' : v); setRows(r => r.map(x => ({ ...x, result: undefined }))); setPhase('edit') }}>
                <SelectTrigger id="bulk-add-category" className="h-10" data-testid="bulk-add-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('category_none')}</SelectItem>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* En-têtes de colonnes : ordinateur seulement */}
          <div className={cn('hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid', desktopCols)}>
            <span>{t('col_name')}</span>
            <span>{t('col_selling_price_cur', { currency })}</span>
            {fullRights && <span>{t('col_buying_price')}</span>}
            <span>{t('col_qty')}</span>
            <span>{t('col_unit')}</span>
            <span />
          </div>

          {rows.map((row, idx) => {
            const res = row.result
            const tone = localErrors[row.id] || res?.status === 'error' ? 'error' : res && (res.status !== 'new' || res.warnings.length) ? 'remark' : res ? 'ready' : null
            return (
              <div key={row.id} data-testid="bulk-add-row" data-status={res?.status ?? ''}
                className={cn('space-y-2 rounded-xl border bg-card p-3 sm:rounded-lg sm:p-2',
                  tone === 'error' && 'border-red-300 dark:border-red-900/70', tone === 'remark' && 'border-amber-300 dark:border-amber-800/70')}>
                <div className={cn('grid grid-cols-2 gap-2 sm:items-start', desktopCols)}>
                  {/* Nom + retirer : une rangée sur téléphone, deux colonnes du tableau sur ordinateur */}
                  <div className="col-span-2 flex items-start gap-2 sm:col-span-1">
                    <div className="min-w-0 flex-1">
                      <Input
                        ref={idx === rows.length - 1 ? lastInputRef : undefined}
                        value={row.name}
                        onChange={e => update(row.id, 'name', e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRow() } }}
                        placeholder={t('row_placeholder', { index: idx + 1 })}
                        aria-label={t('col_name')}
                        maxLength={200}
                        className={cn('h-11 text-base sm:h-10 sm:text-sm', tone === 'error' && 'border-red-400')}
                        data-testid="bulk-add-name"
                      />
                    </div>
                    <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1} aria-label={t('remove_row', { index: idx + 1 })}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40 sm:hidden">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div>
                    <label className={fieldLabel}>{t('col_selling_price_cur', { currency })}</label>
                    <Input type="number" inputMode="decimal" min="0" value={row.selling_price} onChange={e => update(row.id, 'selling_price', e.target.value)}
                      placeholder="0" aria-label={t('col_selling_price')} className="h-11 text-base sm:h-10 sm:text-sm" data-testid="bulk-add-price" />
                  </div>
                  {fullRights && (
                    <div>
                      <label className={fieldLabel}>{t('col_buying_price')}</label>
                      <Input type="number" inputMode="decimal" min="0" value={row.buying_price} onChange={e => update(row.id, 'buying_price', e.target.value)}
                        placeholder="0" aria-label={t('col_buying_price')} className="h-11 text-base sm:h-10 sm:text-sm" data-testid="bulk-add-buying" />
                    </div>
                  )}
                  <div>
                    <label className={fieldLabel}>{t('col_qty')}</label>
                    <Input type="number" inputMode="numeric" min="0" step="1" value={row.quantity} onChange={e => update(row.id, 'quantity', e.target.value)}
                      placeholder="0" aria-label={t('col_qty')} className="h-11 text-base sm:h-10 sm:text-sm" data-testid="bulk-add-qty" />
                  </div>
                  <div>
                    <label className={fieldLabel}>{t('col_unit')}</label>
                    <Select value={row.unit} onValueChange={v => update(row.id, 'unit', v)}>
                      <SelectTrigger className="h-11 sm:h-10 sm:text-sm" aria-label={t('col_unit')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PRODUCT_UNITS.map(u => <SelectItem key={u} value={u}>{unitLabel(u, 1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <button type="button" onClick={() => removeRow(row.id)} disabled={rows.length === 1} aria-label={t('remove_row', { index: idx + 1 })}
                    className="hidden h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40 sm:flex">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {/* Champs facultatifs : code-barres (scan), catégorie, péremption du lot initial (stock > 0) */}
                {more && <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_168px]">
                  <div className="col-span-2 sm:col-span-1">
                    <label className={smallLabel}>{t('col_sku')}</label>
                    <div className="flex">
                      <Input value={row.sku} onChange={e => update(row.id, 'sku', e.target.value)} maxLength={SKU_MAX_LENGTH} aria-label={t('col_sku')}
                        className="h-10 rounded-r-none font-mono text-sm" data-testid="bulk-add-sku" />
                      <button type="button" onClick={() => setScanRow(s => (s === row.id ? null : row.id))} aria-pressed={scanRow === row.id} aria-label={t('scan_for', { index: idx + 1 })}
                        className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-r-md border border-l-0 border-input bg-muted px-3 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                        <Camera className="h-3.5 w-3.5" />{t('scan')}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className={smallLabel}>{t('col_category')}</label>
                    <Select value={row.category_id || NONE} onValueChange={v => update(row.id, 'category_id', v === NONE ? '' : v)} disabled={!categories.length}>
                      <SelectTrigger className="h-10 text-sm" aria-label={t('col_category')}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{globalCategory ? t('category_inherit', { name: categories.find(c => c.id === globalCategory)?.name ?? '' }) : t('category_none')}</SelectItem>
                        {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className={smallLabel}>{t('col_expiry')}</label>
                    {/* La date est celle du stock de départ : sans quantité, rien à dater (explication visible, pas en infobulle) */}
                    {Number(row.quantity) > 0
                      ? <Input type="date" value={row.expiry_date} onChange={e => update(row.id, 'expiry_date', e.target.value)} aria-label={t('col_expiry')} className="h-10 text-sm" data-testid="bulk-add-expiry" />
                      : <p className="flex h-10 items-center text-xs text-muted-foreground" data-testid="bulk-add-expiry-hint">{t('expiry_needs_stock')}</p>}
                  </div>
                </div>}
                {more && scanRow === row.id && (
                  <BarcodeScanner onDetected={code => { update(row.id, 'sku', code); setScanRow(null) }} onClose={() => setScanRow(null)} />
                )}

                {/* Résultat de la vérification */}
                {localErrors[row.id] && <p className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{localErrors[row.id]}</p>}
                {res && (
                  <div className="space-y-1 text-xs" data-testid="bulk-add-result">
                    {res.status === 'new' && !res.warnings.length && <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />{t('status_ready')}</p>}
                    {res.status === 'error' && <p className="flex items-start gap-1.5 text-red-700 dark:text-red-400"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issueText(res)}</p>}
                    {res.status === 'exists' && <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{issueText(res)} {t('not_added_hint')}</p>}
                    {res.warnings.map((w, i) => (
                      <p key={i} className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{tImport(`warning.${w.code}` as any, w.params as any)}</p>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <button type="button" onClick={addRow}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-stockshop-blue hover:text-foreground dark:hover:border-blue-400"
            data-testid="bulk-add-row-add">
            <Plus className="h-4 w-4" />
            {t('add_row')}
            <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] sm:inline">{t('enter_key')}</kbd>
          </button>

          <p className="text-center text-xs text-muted-foreground">
            {t('rows_to_add', { count: rows.length })}<span className="hidden sm:inline"> · {t('enter_hint')}</span>
          </p>
        </div>
      )}
    </FormDrawer>
  )
}
