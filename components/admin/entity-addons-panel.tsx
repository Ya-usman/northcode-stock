'use client'

// Options payées d'une entreprise (migration 210) — fiche boutique de l'admin, onglet Facturation, sous les gestes
// commerciaux. Lecture : support et super_admin. Super_admin : « Retirer une option remboursée » (achat par erreur,
// moins de 48 h, place non utilisée ; le remboursement se fait chez la passerelle), motif obligatoire, journalisé.
// Console interne en français (comme le reste de l'admin).

import { useCallback, useEffect, useState } from 'react'
import { CreditCard, Users, Store, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import { formatCurrency } from '@/lib/utils/currency'

interface Purchase { reference: string; kind: 'plan' | 'addon'; addon_seats: number; addon_shops: number; amount_due: number; currency: string; gateway: string; status: string; created_at: string; period_end: string | null; review_reason: string | null }
interface Data {
  entity: { id: string; name: string | null; plan: string; plan_expires_at: string | null }
  addons: { seats: number; shops: number; seatsRenew: number | null; shopsRenew: number | null }
  purchases: Purchase[]
}
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '')
const STATUS: Record<string, string> = { pending: 'en attente', paid: 'payé', review: 'à vérifier', failed: 'abandonné' }

export function EntityAddonsPanel({ shopId, canWrite }: { shopId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<'seats' | 'shops' | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await withTimeout<Response>(fetch(`/api/admin/entity-addons?shop_id=${shopId}`))
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Erreur'); return }
      setData(json); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [shopId])
  useEffect(() => { load() }, [load])

  const remove = async () => {
    if (!target) return
    setSaving(true)
    try {
      const res = await withTimeout<Response>(fetch('/api/admin/entity-addons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, kind: target, quantity: Number(quantity), reason }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Erreur', variant: 'destructive' }); return }
      toast({ title: 'Option retirée et notée au journal', variant: 'success' })
      setTarget(null); setReason(''); setQuantity('1'); load()
    } finally { setSaving(false) }
  }

  if (error) return <p className="mt-4 text-xs text-red-400">Options payées : {error}</p>
  if (!data) return null
  const { addons } = data
  const row = (kind: 'seats' | 'shops', label: string, icon: React.ReactNode, paid: number, renew: number | null) => (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid={`admin-addons-${kind}`}>
      <span className="flex items-center gap-2 text-sm">{icon}{label}</span>
      <span className="flex items-center gap-3 text-sm">
        <span className="font-semibold tabular-nums">{paid} payée{paid > 1 ? 's' : ''}</span>
        {renew !== null && renew < paid && <span className="text-xs text-amber-400">{paid - renew} non renouvelée{paid - renew > 1 ? 's' : ''} le {fmtDate(data.entity.plan_expires_at)}</span>}
        {canWrite && paid > 0 && (
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => { setTarget(kind); setQuantity('1'); setReason('') }} data-testid={`admin-addons-remove-${kind}`}>
            <Undo2 className="h-3.5 w-3.5" />Retirer une option remboursée
          </Button>
        )}
      </span>
    </div>
  )

  return (
    <div className="mt-5 rounded-xl border border-border p-4" data-testid="admin-addons-panel">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-muted-foreground" />Options payées</h4>
      <p className="mb-2 text-xs text-muted-foreground">Achetées par le client, alignées sur son abonnement (fin le {fmtDate(data.entity.plan_expires_at) || 'non définie'}).</p>
      <div className="divide-y divide-border">
        {row('seats', 'Employés en plus', <Users className="h-4 w-4 text-muted-foreground" />, addons.seats, addons.seatsRenew)}
        {row('shops', 'Boutiques en plus', <Store className="h-4 w-4 text-muted-foreground" />, addons.shops, addons.shopsRenew)}
      </div>
      {data.purchases.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs" data-testid="admin-addons-purchases">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3 font-medium">Date</th><th className="py-1 pr-3 font-medium">Achat</th><th className="py-1 pr-3 font-medium">Montant</th><th className="py-1 pr-3 font-medium">Passerelle</th><th className="py-1 font-medium">État</th></tr></thead>
            <tbody>
              {data.purchases.map(p => (
                <tr key={p.reference} className="border-t border-border">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(p.created_at)}</td>
                  <td className="py-1.5 pr-3">{p.kind === 'addon' ? 'Option' : 'Renouvellement'} · {[p.addon_seats ? `${p.addon_seats} employé${p.addon_seats > 1 ? 's' : ''}` : '', p.addon_shops ? `${p.addon_shops} boutique${p.addon_shops > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + ')}</td>
                  <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">{formatCurrency(Number(p.amount_due), p.currency)}</td>
                  <td className="py-1.5 pr-3">{p.gateway}</td>
                  <td className="py-1.5">{STATUS[p.status] || p.status}{p.review_reason ? ` (${p.review_reason})` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {target && (
        <ConfirmModal
          open
          onOpenChange={o => { if (!o) setTarget(null) }}
          title={`Retirer ${target === 'seats' ? 'des employés' : 'des boutiques'} en plus`}
          description="À utiliser seulement après un remboursement (achat par erreur, moins de 48 h, place non utilisée). Le remboursement se fait dans l'espace de la passerelle de paiement."
          confirmLabel="Retirer et noter au journal"
          tone="danger"
          loading={saving}
          disabled={reason.trim().length < 3 || !(Number(quantity) >= 1)}
          onConfirm={remove}
        >
          <div className="space-y-2">
            <label className="block text-xs font-medium">Quantité
              <Input type="number" min={1} max={target === 'seats' ? addons.seats : addons.shops} value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 h-9" />
            </label>
            <label className="block text-xs font-medium">Motif (obligatoire)
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Ex. achat en double, remboursé le 4 nov. (réf. Flutterwave …)" className="mt-1 h-9" data-testid="admin-addons-reason" />
            </label>
          </div>
        </ConfirmModal>
      )}
    </div>
  )
}
