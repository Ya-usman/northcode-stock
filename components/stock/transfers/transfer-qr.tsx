'use client'

// QR d'un transfert en transit (affichage, bon PDF, partage) et scan d'un QR (Stock › Transferts V1).
// Le QR ne contient que l'adresse de réception (identifiant + jeton aléatoire) ; le serveur vérifie toujours les
// droits. Un scan n'ouvre QUE l'écran de réception : il ne réceptionne jamais.
import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Loader2, QrCode, ScanLine, XCircle } from 'lucide-react'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Button } from '@/components/ui/button'
import { BarcodeScanner } from '@/components/stock/barcode-scanner'
import { formatLocaleDate, formatLocaleTime } from '@/lib/i18n/date-format'

/** Adresse du QR d'un transfert en transit (null si indisponible) */
export async function fetchTransferQrUrl(id: string, locale: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/stock-transfers/${id}/qr?locale=${locale}`)
    if (!res.ok) return null
    return (await res.json()).data?.url ?? null
  } catch { return null }
}

/** Image PNG (data URL) d'un texte en QR */
export async function qrDataUrl(text: string, width = 480): Promise<string> {
  const QRCode = await import('qrcode')
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width })
}

export function TransferQrDialog({ transfer, onOpenChange }: { transfer: { id: string; reference: string } | null; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  const [img, setImg] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  useEffect(() => {
    if (!transfer) return
    let cancelled = false
    setImg(null); setState('loading')
    fetchTransferQrUrl(transfer.id, locale).then(async url => {
      if (cancelled) return
      if (!url) { setState('unavailable'); return }
      setImg(await qrDataUrl(url)); setState('ready')
    })
    return () => { cancelled = true }
  }, [transfer, locale])
  return (
    <PremiumDialog open={!!transfer} onOpenChange={onOpenChange} title={t('qr_title')} icon={<QrCode className="h-4 w-4" />} maxWidth="max-w-sm">
      <PremiumDialogBody>
        <div className="flex flex-col items-center gap-3 py-2" data-testid="transfer-qr">
          <p className="text-lg font-bold tabular-nums">{transfer?.reference}</p>
          {state === 'loading' && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
          {state === 'ready' && img && <img src={img} alt={t('qr_title')} className="h-64 w-64 rounded-lg border bg-white p-2" />}
          {state === 'unavailable' && <p className="text-sm text-muted-foreground">{t('qr_unavailable')}</p>}
          <p className="text-center text-xs text-muted-foreground">{t('qr_hint')}</p>
        </div>
      </PremiumDialogBody>
    </PremiumDialog>
  )
}

type ScanResult =
  | { result: 'ok'; transfer: { id: string; reference: string } }
  | { result: 'wrong_shop'; transfer?: { reference: string; destination_shop_name: string | null } }
  | { result: 'already_received'; transfer: { reference: string; received_at: string; received_by_name: string | null } }
  | { result: 'cancelled' | 'forbidden' | 'invalid'; transfer?: { reference?: string } }

/** Vérifie un QR scanné auprès du serveur (boutique active transmise : le serveur la compare à la destination réelle) */
export async function checkTransferCode(code: string, activeShopId: string | null): Promise<ScanResult> {
  const res = await fetch('/api/stock-transfers/scan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, active_shop_id: activeShopId }),
  })
  if (!res.ok) return { result: 'invalid' }
  return res.json()
}

/** Message d'un résultat de scan qui n'ouvre pas la réception */
export function ScanResultMessage({ r }: { r: ScanResult }) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  if (r.result === 'already_received') {
    const at = new Date(r.transfer.received_at)
    return (
      <div className="flex flex-col items-center gap-2 text-center" data-testid="scan-already-received">
        <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
        <p className="font-semibold">{t('scan_already_received')}</p>
        <p className="text-sm text-muted-foreground">{r.transfer.reference}</p>
        <p className="text-sm text-muted-foreground">{t('scan_already_received_detail', {
          date: formatLocaleDate(at, locale, { day: 'numeric', month: 'short', year: 'numeric' }),
          time: formatLocaleTime(at, locale),
          name: r.transfer.received_by_name || '?',
        })}</p>
      </div>
    )
  }
  const text = r.result === 'wrong_shop'
    ? (r.transfer?.destination_shop_name ? t('scan_wrong_shop', { shop: r.transfer.destination_shop_name }) : t('scan_forbidden'))
    : r.result === 'cancelled' ? t('scan_cancelled') : r.result === 'forbidden' ? t('scan_forbidden') : t('scan_invalid')
  const Icon = r.result === 'invalid' ? XCircle : AlertTriangle
  return (
    <div className="flex flex-col items-center gap-2 text-center" data-testid={`scan-${r.result}`}>
      <Icon className="h-10 w-10 text-amber-600 dark:text-amber-400" />
      {r.transfer?.reference && <p className="text-sm font-semibold tabular-nums">{r.transfer.reference}</p>}
      <p className="font-medium">{text}</p>
      {r.result === 'wrong_shop' && r.transfer?.destination_shop_name && <p className="text-sm text-muted-foreground">{t('scan_wrong_shop_hint')}</p>}
    </div>
  )
}

export function TransferScanDialog({ open, onOpenChange, activeShopId }: { open: boolean; onOpenChange: (open: boolean) => void; activeShopId: string | null }) {
  const t = useTranslations('transfers')
  const locale = useLocale()
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [outcome, setOutcome] = useState<ScanResult | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => { if (open) { setOutcome(null); setChecking(false) } }, [open])
  const onDetected = useCallback(async (code: string) => {
    setChecking(true)
    try {
      const r = await checkTransferCode(code, activeShopId)
      if (r.result === 'ok') {
        // Le jeton accompagne l'adresse : l'écran de réception sait qu'il a été ouvert par un scan valide
        const k = code.match(/[?&]k=([0-9a-f]{64})/i)?.[1] || code.match(/^STKTR:[0-9a-f-]{36}:([0-9a-f]{64})$/i)?.[1] || ''
        onOpenChange(false)
        router.push(`/${locale}/stock/transfers/${r.transfer.id}/receive${k ? `?k=${k}` : ''}`)
        return
      }
      setOutcome(r)
    } finally {
      setChecking(false)
    }
  }, [activeShopId, locale, onOpenChange, router])
  return (
    <PremiumDialog open={open} onOpenChange={onOpenChange} title={t('scan_title')} icon={<ScanLine className="h-4 w-4" />} maxWidth="max-w-md">
      <PremiumDialogBody>
        {outcome ? <ScanResultMessage r={outcome} /> : (
          <div className="space-y-2" data-testid="transfer-scan">
            <p className="text-sm text-muted-foreground">{checking ? t('scan_checking') : t('scan_hint')}</p>
            {!checking && <BarcodeScanner key={round} onDetected={onDetected} onClose={() => onOpenChange(false)} />}
            {checking && <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}
          </div>
        )}
      </PremiumDialogBody>
      {outcome && (
        <PremiumDialogFooter onCancel={() => onOpenChange(false)} cancelLabel={t('back')}>
          <Button variant="stockshop" className="flex-1 h-11" onClick={() => { setOutcome(null); setRound(r => r + 1) }}>{t('scan_again')}</Button>
        </PremiumDialogFooter>
      )}
    </PremiumDialog>
  )
}
