'use client'

// Réception d'un transfert (Stock › Transferts V1, page dédiée, mobile d'abord). Ouverte depuis la liste ou par le QR
// (le jeton est alors revérifié par le serveur : mauvaise boutique, déjà reçu, annulé → message, aucune action).
// « Vérifier les articles reçus » : une carte par produit (photo, lot, péremption, envoyé, reçu avec − / +, écart
// en orange, cause facultative) ; mode « Scanner les articles » (part de 0, chaque scan ajoute 1, alertes « hors
// transfert » et « quantité atteinte ») ; résumé ; « Confirmer la réception » (confirmation, avec le nombre d'unités
// manquantes s'il y en a). Une seule opération définitive côté serveur ; « Retour » n'enregistre rien.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, Minus, Package, Plus, ScanLine, Store } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { BarcodeScanner } from '@/components/stock/barcode-scanner'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'
import { normalize } from '@/lib/utils/normalize'
import { useUnitLabel } from '@/lib/products/use-unit-label'
import { cn } from '@/lib/utils/cn'
import { clampReceived, receiveSummary, scanArticle } from '@/lib/stock/transfers-view'
import { TransferStatusBadge } from './transfer-card'
import { ScanResultMessage, checkTransferCode } from './transfer-qr'

const supabase = createClient() as any
const CAUSES = ['transport_loss', 'theft', 'breakage', 'count_error', 'other'] as const
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

interface LineState { received: number; destination_product_id: string | null; cause: string; detail: string; matchSearch: string; changing: boolean }

export function TransferReceive({ id, token }: { id: string; token: string | null }) {
  const t = useTranslations('transfers')
  const tRoot = useTranslations()
  const locale = useLocale()
  const router = useRouter()
  const unitLabel = useUnitLabel()
  const { toast } = useToast()
  const { shop, dashboardShopFilter } = useAuthContext()
  const [tr, setTr] = useState<any | null>(null)
  const [blocked, setBlocked] = useState<any | null>(null)   // résultat de scan qui n'ouvre pas la réception
  const [error, setError] = useState<string | null>(null)
  const [byScan, setByScan] = useState(false)
  const [lines, setLines] = useState<Record<string, LineState>>({})
  const [destProducts, setDestProducts] = useState<{ id: string; name: string; sku: string | null }[]>([])
  const [scanMode, setScanMode] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const receiptKey = useRef(newKey())   // une réception renvoyée (réseau lent) n'est appliquée qu'une fois

  const back = () => router.push(`/${locale}/stock/transfers`)
  const dShort = (iso: string) => formatLocaleDate(iso, locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const dLong = (iso: string) => formatLocaleDate(iso, locale, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = (iso: string) => formatLocaleTime(iso, locale)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Ouverture par le QR : le serveur revérifie le jeton, la boutique active et les droits
      if (token) {
        const r = await checkTransferCode(`STKTR:${id}:${token}`, dashboardShopFilter ?? shop?.id ?? null)
        if (cancelled) return
        if (r.result !== 'ok') { setBlocked(r); return }
        setByScan(true)
      }
      const res = await fetch(`/api/stock-transfers/${id}`)
      const json = await res.json().catch(() => ({}))
      if (cancelled) return
      if (!res.ok) { setError(json.error || tRoot('toast.error')); return }
      const d = json.data
      if (!d.can_receive) {
        if (d.status === 'received') setBlocked({ result: 'already_received', transfer: { reference: d.reference, received_at: d.received_at, received_by_name: d.received_by_name } })
        else setError(t('not_receivable_here'))
        return
      }
      setTr(d)
      // Produits de la boutique d'arrivée : correspondance par code-barres, puis par nom exact ; sinon créé à la réception
      const { data: prods } = await supabase.from('products').select('id, name, sku').eq('shop_id', d.destination_shop_id).eq('is_active', true).order('name')
      if (cancelled) return
      const list = (prods || []) as any[]
      setDestProducts(list)
      const init: Record<string, LineState> = {}
      for (const it of d.stock_transfer_items) {
        const match = (it.destination_product_id && list.find(p => p.id === it.destination_product_id))
          || (it.sku && list.find(p => (p.sku || '') === it.sku))
          || list.find(p => normalize(p.name) === normalize(it.product_name))
        init[it.id] = { received: it.quantity_sent, destination_product_id: match?.id ?? null, cause: '', detail: '', matchSearch: '', changing: false }
      }
      setLines(init)
    })().catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [id, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const items: any[] = tr?.stock_transfer_items || []
  const summary = useMemo(() => receiveSummary(items.map(it => ({ item_id: it.id, sent: it.quantity_sent, received: lines[it.id]?.received ?? 0 }))), [items, lines])
  const setLine = (itemId: string, patch: Partial<LineState>) => setLines(prev => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }))

  // Mode scan : on compte ce qu'on a dans les mains (départ à 0), un scan = +1
  const startScan = () => {
    setLines(prev => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, received: 0 }])))
    setScanMode(true)
  }
  const onScan = useCallback((code: string) => {
    setLines(prev => {
      const r = scanArticle(items.map(it => ({ item_id: it.id, sku: it.sku, sent: it.quantity_sent, received: prev[it.id]?.received ?? 0 })), code)
      if (r.result === 'unknown') { toast({ title: t('scan_not_in_transfer'), variant: 'destructive' }); return prev }
      const it = items.find(x => x.id === r.item_id)
      if (r.result === 'full') { toast({ title: t('scan_full', { name: it?.product_name || '' }) }); return prev }
      return { ...prev, [r.item_id!]: { ...prev[r.item_id!], received: (prev[r.item_id!]?.received ?? 0) + 1 } }
    })
  }, [items, t, toast])

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await fetch('/api/stock-transfers/receive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transfer_id: id, receipt_key: receiptKey.current,
          items: items.map(it => {
            const l = lines[it.id]
            const gap = it.quantity_sent - clampReceived(l.received, it.quantity_sent)
            return { transfer_item_id: it.id, quantity_received: clampReceived(l.received, it.quantity_sent), destination_product_id: l.destination_product_id,
              discrepancy_category: gap > 0 && l.cause ? l.cause : null, discrepancy_detail: gap > 0 && l.detail.trim() ? l.detail.trim() : null }
          }),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.status === 409 && json.code === 'transfer_already_received') {
        setConfirming(false)
        setBlocked({ result: 'already_received', transfer: { reference: tr.reference, received_at: json.received_at, received_by_name: json.received_by_name } })
        return
      }
      if (!res.ok) { toast({ title: json.error || tRoot('toast.error'), variant: 'destructive' }); return }
      const missing = Number(json.data?.missing) || 0
      toast({ title: missing > 0 ? t('received_toast_gap', { count: missing }) : tRoot('transfers.received_toast'), variant: 'success' })
      for (const cp of (json.data?.created_products || []) as any[]) if (cp.needs_price) toast({ title: tRoot('transfers.needs_price_toast', { name: cp.name }) })
      back()
    } catch (e: any) {
      toast({ title: e.message || tRoot('toast.error'), variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  // ── États sans réception possible ─────────────────────────────────────────
  if (blocked || error) {
    return (
      <div className="mx-auto max-w-lg space-y-4 pb-8" data-testid="receive-blocked">
        <h1 className="text-xl font-bold">{t('receive_page_title')}</h1>
        <div className="rounded-xl border bg-card p-6">
          {blocked ? <ScanResultMessage r={blocked} /> : <p className="text-center text-sm text-muted-foreground">{error}</p>}
        </div>
        <Button variant="outline" className="h-11 w-full gap-2" onClick={back}><ArrowLeft className="h-4 w-4" />{t('back')}</Button>
      </div>
    )
  }
  if (!tr) return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-40" data-testid="transfer-receive">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-11 w-11" onClick={back} aria-label={t('back')}><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-xl font-bold">{t('receive_page_title')}</h1>
      </div>

      {/* Résumé du transfert */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-lg font-bold tabular-nums">{tr.reference}</p>
          <TransferStatusBadge status={tr.status} />
          {byScan && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950/40 dark:text-green-400" data-testid="receive-by-scan"><CheckCircle2 className="h-3.5 w-3.5" />{t('opened_by_scan')}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4 text-muted-foreground" />{tr.source_shop_name}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <span className="inline-flex items-center gap-1.5"><Store className="h-4 w-4 text-muted-foreground" />{tr.destination_shop_name}</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr.sent_by_name ? t('sent_on_by', { date: dLong(tr.sent_at || tr.created_at), name: tr.sent_by_name }) : t('sent_on', { date: dLong(tr.sent_at || tr.created_at) })}
        </p>
      </div>

      {/* Vérifier les articles reçus */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('verify_title')}</h2>
        <Button variant={scanMode ? 'stockshop' : 'outline'} className="h-11 gap-2" onClick={() => scanMode ? setScanMode(false) : startScan()} data-testid="receive-scan-mode">
          <ScanLine className="h-4 w-4 shrink-0" />{scanMode ? t('scan_mode_off') : t('scan_articles')}
        </Button>
      </div>
      {scanMode && (
        <div className="space-y-2">
          <p className="rounded-lg bg-stockshop-blue-muted px-3 py-2 text-sm text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300">{t('scan_mode_on')}</p>
          <BarcodeScanner continuous onDetected={onScan} onClose={() => setScanMode(false)} />
        </div>
      )}

      <div className="space-y-3">
        {items.map(it => {
          const l = lines[it.id]
          if (!l) return null
          const received = clampReceived(l.received, it.quantity_sent)
          const gap = it.quantity_sent - received
          const matched = destProducts.find(p => p.id === l.destination_product_id)
          const matchResults = l.changing && l.matchSearch.trim() ? destProducts.filter(p => normalize(p.name).includes(normalize(l.matchSearch))).slice(0, 8) : []
          return (
            <div key={it.id} className={cn('rounded-xl border bg-card p-3 shadow-sm', gap > 0 && 'border-amber-300 dark:border-amber-800')} data-testid="receive-line">
              <div className="flex items-start gap-3">
                {it.image_url
                  ? <img src={it.image_url} alt="" className="h-14 w-14 shrink-0 rounded-lg border object-cover" />
                  : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-muted"><Package className="h-6 w-6 text-muted-foreground" /></div>}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{it.product_name}</p>
                  {(it.lots || []).length > 0 ? (
                    <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                      {it.lots.map((lot: any, i: number) => (
                        <li key={i}>{lot.coverage === 'batch'
                          ? <>{lot.source_received_at ? t('lot_label', { date: dShort(lot.source_received_at) }) : ''}{lot.source_expiry_date ? ` · ${t('lot_expiry', { date: dShort(lot.source_expiry_date) })}` : ` · ${t('lot_no_expiry')}`}</>
                          : t('lot_untracked')}{it.lots.length > 1 ? ` (${lot.quantity_sent})` : ''}</li>
                      ))}
                    </ul>
                  ) : it.sku ? <p className="text-xs text-muted-foreground tabular-nums">{it.sku}</p> : null}
                  {!it.sku && scanMode && <p className="text-xs text-amber-700 dark:text-amber-400">{t('no_barcode')}</p>}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-sm"><p className="text-muted-foreground">{tRoot('transfers.sent_label')}</p><p className="text-lg font-bold tabular-nums">{it.quantity_sent}</p></div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="icon" className="h-12 w-12" onClick={() => setLine(it.id, { received: clampReceived(received - 1, it.quantity_sent) })} aria-label={t('decrease')} disabled={received <= 0}><Minus className="h-5 w-5" /></Button>
                  <Input type="number" inputMode="numeric" min={0} max={it.quantity_sent} value={received}
                    onChange={e => setLine(it.id, { received: clampReceived(Number(e.target.value), it.quantity_sent) })}
                    className="h-12 w-20 text-center text-lg font-bold tabular-nums" aria-label={`${t('received_label')} : ${it.product_name}`} data-testid="receive-qty" />
                  <Button type="button" variant="outline" size="icon" className="h-12 w-12" onClick={() => setLine(it.id, { received: clampReceived(received + 1, it.quantity_sent) })} aria-label={t('increase')} disabled={received >= it.quantity_sent}><Plus className="h-5 w-5" /></Button>
                </div>
              </div>

              {gap > 0 && (
                <div className="mt-3 space-y-2 rounded-lg bg-amber-50 p-2.5 dark:bg-amber-950/30">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400" data-testid="receive-gap"><AlertTriangle className="h-4 w-4" />{t('missing_units', { count: gap })}</p>
                  <Select value={l.cause} onValueChange={v => setLine(it.id, { cause: v })}>
                    <SelectTrigger className="h-10 bg-background text-sm"><SelectValue placeholder={t('cause_label')} /></SelectTrigger>
                    <SelectContent>{CAUSES.map(c => <SelectItem key={c} value={c}>{tRoot(`transfers.discrepancy_${c}` as any)}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={l.detail} onChange={e => setLine(it.id, { detail: e.target.value })} placeholder={t('cause_detail_placeholder')} maxLength={300} className="h-10 bg-background text-sm" />
                </div>
              )}

              {/* Produit de la boutique d'arrivée (correspondance, sinon créé à la réception) */}
              <div className="mt-3 border-t pt-2 text-xs">
                <p className="text-muted-foreground">{tRoot('transfers.match_product_label')}</p>
                {!l.changing ? (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{matched?.name ?? tRoot('transfers.no_match_will_create')}</span>
                    <button type="button" className="shrink-0 text-stockshop-blue hover:underline dark:text-blue-400" onClick={() => setLine(it.id, { changing: true, matchSearch: '' })}>{tRoot('transfers.change_match')}</button>
                  </div>
                ) : (
                  <div className="mt-1 space-y-1">
                    <Input value={l.matchSearch} onChange={e => setLine(it.id, { matchSearch: e.target.value })} placeholder={tRoot('transfers.search_own_product_placeholder')} className="h-10 text-sm" autoFocus />
                    {matchResults.length > 0 && (
                      <div className="max-h-40 divide-y overflow-y-auto rounded-md border">
                        {matchResults.map(p => (
                          <button key={p.id} type="button" className="block min-h-10 w-full px-2 py-2 text-left hover:bg-accent" onClick={() => setLine(it.id, { destination_product_id: p.id, changing: false })}>{p.name}</button>
                        ))}
                      </div>
                    )}
                    <button type="button" className="text-muted-foreground hover:underline" onClick={() => setLine(it.id, { destination_product_id: null, changing: false })}>{tRoot('transfers.no_match_will_create')}</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Résumé de la réception */}
      <div className="rounded-xl border bg-card p-4" data-testid="receive-summary">
        <h2 className="mb-2 text-base font-semibold">{t('summary_title')}</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{t('summary_articles')}</dt><dd className="text-right font-semibold tabular-nums">{summary.articles}</dd>
          <dt className="text-muted-foreground">{t('summary_sent')}</dt><dd className="text-right font-semibold tabular-nums">{summary.sent}</dd>
          <dt className="text-muted-foreground">{t('summary_received')}</dt><dd className="text-right font-semibold tabular-nums">{summary.received}</dd>
          <dt className={summary.missing > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>{t('summary_gap')}</dt>
          <dd className={cn('text-right font-bold tabular-nums', summary.missing > 0 && 'text-amber-700 dark:text-amber-400')}>{summary.missing}</dd>
        </dl>
      </div>

      {/* Actions : toujours visibles au pouce */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+64px)] z-30 border-t bg-card/95 px-4 py-3 backdrop-blur sm:bottom-0 sm:left-64">
        <div className="mx-auto flex max-w-2xl gap-2">
          <Button variant="outline" className="h-12 flex-1" onClick={back}>{t('back')}</Button>
          <Button variant="stockshop" className="h-12 flex-[2]" onClick={() => setConfirming(true)} data-testid="receive-confirm">{t('confirm_reception')}</Button>
        </div>
      </div>

      <PremiumDialog open={confirming} onOpenChange={o => { if (!submitting) setConfirming(o) }} title={t('confirm_reception')} icon={summary.missing > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} maxWidth="max-w-md">
        <PremiumDialogBody>
          <p className={cn('text-sm', summary.missing > 0 && 'font-medium text-amber-700 dark:text-amber-400')} data-testid="receive-confirm-text">
            {summary.missing > 0 ? t('confirm_missing', { count: summary.missing }) : t('confirm_ok', { count: summary.received })}
          </p>
        </PremiumDialogBody>
        <PremiumDialogFooter onCancel={() => setConfirming(false)} cancelLabel={t('back')}>
          <Button variant="stockshop" className="h-11 flex-1" loading={submitting} onClick={submit} data-testid="receive-confirm-final">{t('confirm_reception')}</Button>
        </PremiumDialogFooter>
      </PremiumDialog>
    </div>
  )
}
