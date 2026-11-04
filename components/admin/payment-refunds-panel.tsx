'use client'

// « Paiements récents » (4 nov. 2026) — page Facturation de l'admin. Remboursement d'un paiement fait PAR ERREUR,
// signalé sous 48 h (pas de remboursement sinon : l'essai de 30 jours sert de garantie). Super_admin seul ; motif
// obligatoire ; la situation d'avant le paiement est remise et l'action est journalisée. Le virement lui-même se fait
// chez la passerelle. Console interne en français (comme le reste de l'admin).

import { useCallback, useEffect, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import { formatCurrency } from '@/lib/utils/currency'

interface Row {
  reference: string; kind: string; plan: string | null; billing_period: string | null; currency: string
  amount_due: number; paid_amount: number | null; gateway: string; status: string; settled_at: string
  schedule: string | null; prev_plan: string | null; addon_seats: number | null; addon_shops: number | null; entity_name: string
}

const KIND: Record<string, string> = { plan: 'formule', addon: 'options', custom: 'sur mesure' }
const SCHEDULE: Record<string, string> = { now: 'immédiat', stack: 'à la suite', next: 'à la fin de la période' }

export function PaymentRefundsPanel() {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [edit, setEdit] = useState<{ reference: string; reason: string; late: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await withTimeout(fetch('/api/admin/payments/refund')).catch(() => null)
    if (!res || !res.ok) { setRows(null); return }
    setRows((await res.json()).payments || [])
  }, [])
  useEffect(() => { load() }, [load])

  const refund = async () => {
    if (!edit) return
    setBusy(true)
    try {
      const res = await withTimeout(fetch('/api/admin/payments/refund', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference: edit.reference, reason: edit.reason, late: edit.late }),
      }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (json.code === 'late') setEdit({ ...edit, late: true })
        toast({ title: json.error || 'Action refusée', variant: 'destructive' }); return
      }
      toast({ title: `Paiement marqué remboursé : ${json.restored}`, variant: 'success' })
      setEdit(null); await load()
    } finally { setBusy(false) }
  }

  if (rows === null) return null // pas super_admin, ou chargement
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4" data-testid="payment-refunds-panel">
      <div className="mb-1 flex items-center gap-2">
        <Undo2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Paiements des 7 derniers jours</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Pas de remboursement des formules, sauf un paiement fait par erreur et signalé sous 48 h. Le remboursement remet la
        situation d’avant le paiement ; l’argent se rend chez la passerelle.
      </p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Aucun paiement.</p> : (
        <div className="divide-y divide-border">
          {rows.map(r => {
            const hours = Math.round((Date.now() - new Date(r.settled_at).getTime()) / 3_600_000)
            const open = edit?.reference === r.reference
            return (
              <div key={r.reference} className="py-3 text-sm" data-testid="refund-row">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">{r.entity_name || '?'} <span className="text-xs text-muted-foreground">· {KIND[r.kind] ?? r.kind}{r.plan ? ` ${r.plan}` : ''}{r.schedule && r.kind !== 'addon' ? ` · ${SCHEDULE[r.schedule] ?? r.schedule}` : ''}</span></p>
                  <p className="text-xs tabular-nums">{formatCurrency(Number(r.paid_amount ?? r.amount_due), r.currency)} · {r.gateway} · il y a {hours} h</p>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">{r.reference}{r.prev_plan ? ` · avant : ${r.prev_plan}` : ''}</p>
                  {r.status === 'refunded' ? (
                    <span className="text-xs font-medium text-muted-foreground" data-testid="refund-done">Remboursé</span>
                  ) : !open && (
                    <Button size="sm" variant="outline" onClick={() => setEdit({ reference: r.reference, reason: '', late: false })} data-testid="refund-open">
                      Rembourser (erreur)
                    </Button>
                  )}
                </div>
                {open && edit && (
                  <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-3">
                    {hours > 48 && <p className="text-xs text-amber-700 dark:text-amber-400">Payé il y a plus de 48 h : la règle ne prévoit pas de remboursement.</p>}
                    <Input value={edit.reason} maxLength={300} placeholder="Motif (ex. double paiement, mauvaise formule)" onChange={e => setEdit({ ...edit, reason: e.target.value })} data-testid="refund-reason" />
                    {edit.late && (
                      <label className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked readOnly /> Rembourser malgré le délai dépassé
                      </label>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={busy || edit.reason.trim().length < 3} onClick={refund} data-testid="refund-confirm">
                        {edit.late ? 'Confirmer malgré le délai' : 'Confirmer le remboursement'}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEdit(null)}>Annuler</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
