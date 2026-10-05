'use client'

// Gestes commerciaux d'une entreprise (migration 157) — fiche boutique de
// l'admin, onglet Facturation. Super_admin : accorder / retirer ; support :
// lecture seule. Console interne en français (comme le reste de l'admin).

import { useCallback, useEffect, useState } from 'react'
import { Gift, Plus, Ban, Users, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'

interface Limit { plan: number; offered: number; effective: number; used: number }
interface Situation {
  entity: { id: string; name: string | null; plan: string; plan_name: string }
  grants: { id: string; kind: 'team_seats' | 'shops'; quantity: number; reason: string; granted_at: string; expires_at: string | null; revoked_at: string | null; revoke_reason: string | null }[]
  limits: { team_seats: Limit; shops: Limit }
}

const KIND_LABEL = { team_seats: 'membre(s) supplémentaire(s)', shops: 'boutique(s) supplémentaire(s)' } as const
const fmtDate = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
const fmtLimit = (n: number) => (n === -1 ? 'illimité' : String(n))
/** Jours restants si la fin tombe dans 7 jours ou moins, sinon null */
const endsSoon = (d: string | null) => {
  if (!d) return null
  const days = Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000)
  return days > 0 && days <= 7 ? days : null
}

export function EntityGrantsPanel({ shopId, canWrite }: { shopId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const [data, setData] = useState<Situation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [kind, setKind] = useState<'team_seats' | 'shops'>('team_seats')
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [indefinite, setIndefinite] = useState(true)
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Situation['grants'][number] | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await withTimeout<Response>(fetch(`/api/admin/entity-grants?shop_id=${shopId}`))
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Erreur'); return }
      setData(json); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [shopId])
  useEffect(() => { load() }, [load])

  const grant = async () => {
    setSaving(true)
    try {
      const res = await withTimeout<Response>(fetch('/api/admin/entity-grants', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, kind, quantity: Number(quantity), reason, expires_at: indefinite ? null : expiresAt || null }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Erreur', variant: 'destructive' }); return }
      setData(json); setFormOpen(false); setReason(''); setQuantity('1'); setIndefinite(true); setExpiresAt('')
      toast({ title: 'Geste commercial accordé', variant: 'success' })
    } finally { setSaving(false) }
  }

  const revoke = async () => {
    if (!revokeTarget) return
    setSaving(true)
    try {
      const res = await withTimeout<Response>(fetch(`/api/admin/entity-grants?id=${revokeTarget.id}&shop_id=${shopId}&reason=${encodeURIComponent(revokeReason)}`, { method: 'DELETE' }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Erreur', variant: 'destructive' }); return }
      setData(json); setRevokeTarget(null); setRevokeReason('')
      const over = json.over_limit || {}
      toast({
        title: 'Geste retiré',
        description: over.team_seats || over.shops
          ? `L'entreprise dépasse maintenant sa limite (${over.team_seats ? `${over.team_seats} membre(s)` : ''}${over.team_seats && over.shops ? ', ' : ''}${over.shops ? `${over.shops} boutique(s)` : ''}). Personne n'est suspendu : seules les nouvelles invitations sont bloquées.`
          : undefined,
      })
    } finally { setSaving(false) }
  }

  const active = (data?.grants || []).filter(g => !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > new Date()))
  const history = (data?.grants || []).filter(g => !active.includes(g))
  const LimitLine = ({ icon: Icon, label, l }: { icon: any; label: string; l: Limit }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4" />{label}</span>
      <span className="tabular-nums font-medium text-foreground">
        {l.used} / {fmtLimit(l.effective)}
        {l.offered > 0 && <span className="ml-1.5 text-xs font-normal text-emerald-500">({fmtLimit(l.plan)} + {l.offered} offert{l.offered > 1 ? 's' : ''})</span>}
      </span>
    </div>
  )

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4" data-testid="admin-entity-grants">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gift className="h-4 w-4 text-emerald-500" />
          Gestes commerciaux{data?.entity.name ? ` · ${data.entity.name}` : ''}
        </h3>
        {canWrite && data && !formOpen && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setFormOpen(true)} data-testid="grant-open">
            <Plus className="h-3.5 w-3.5" /> Accorder
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        S&apos;ajoutent à la formule de l&apos;entreprise (toutes ses boutiques), survivent aux changements de formule, ne comptent jamais comme revenu.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <div className="space-y-2">
          <LimitLine icon={Users} label={`Membres · ${data.entity.plan_name}`} l={data.limits.team_seats} />
          <LimitLine icon={Store} label="Boutiques" l={data.limits.shops} />
        </div>
      )}

      {formOpen && canWrite && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_96px]">
            <select value={kind} onChange={e => setKind(e.target.value as any)} className="h-9 rounded-md border border-input bg-card px-2 text-sm" data-testid="grant-kind">
              <option value="team_seats">Membres supplémentaires</option>
              <option value="shops">Boutiques supplémentaires</option>
            </select>
            <Input type="number" min={1} max={50} value={quantity} onChange={e => setQuantity(e.target.value)} className="h-9" aria-label="Quantité" data-testid="grant-quantity" />
          </div>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif (obligatoire) — ex. geste commercial, client fidèle" className="h-9" data-testid="grant-reason" />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={indefinite} onChange={() => setIndefinite(true)} /> Durée indéterminée</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!indefinite} onChange={() => setIndefinite(false)} /> Jusqu&apos;au</label>
            {!indefinite && <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="h-9 w-40" />}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Annuler</Button>
            <Button size="sm" variant="stockshop" onClick={grant} loading={saving} disabled={reason.trim().length < 3 || (!indefinite && !expiresAt)} data-testid="grant-submit">
              Accorder
            </Button>
          </div>
        </div>
      )}

      {data && (active.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {active.map(g => (
            <li key={g.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  +{g.quantity} {KIND_LABEL[g.kind]}
                  {endsSoon(g.expires_at) !== null && (
                    <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400" data-testid="grant-ends-soon">
                      fin dans {endsSoon(g.expires_at)} j · propriétaire prévenu à J-7 et la veille
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{g.reason} · depuis le {fmtDate(g.granted_at)} · {g.expires_at ? `jusqu'au ${fmtDate(g.expires_at)}` : 'durée indéterminée'}</p>
              </div>
              {canWrite && (
                <Button size="sm" variant="ghost" className="h-8 gap-1 text-muted-foreground hover:text-destructive" onClick={() => setRevokeTarget(g)}>
                  <Ban className="h-3.5 w-3.5" /> Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun geste commercial actif.</p>
      ))}

      {history.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Historique ({history.length})</summary>
          <ul className="mt-2 space-y-1">
            {history.map(g => (
              <li key={g.id}>+{g.quantity} {KIND_LABEL[g.kind]} · {g.reason} · {fmtDate(g.granted_at)} → {g.revoked_at ? `retiré le ${fmtDate(g.revoked_at)}${g.revoke_reason ? ` (${g.revoke_reason})` : ''}` : `expiré le ${fmtDate(g.expires_at!)}`}</li>
            ))}
          </ul>
        </details>
      )}

      <ConfirmModal
        open={!!revokeTarget}
        onOpenChange={open => { if (!open && !saving) { setRevokeTarget(null); setRevokeReason('') } }}
        title="Retirer ce geste commercial ?"
        description="Le retrait ne suspend personne : si l'entreprise dépasse sa limite, les nouvelles invitations et créations sont bloquées. Attention : le contrôle des limites après un paiement (s'il est activé) appliquera ensuite la limite sans ce geste."
        tone="danger"
        confirmLabel="Retirer"
        loading={saving}
        onConfirm={revoke}
      >
        <Input value={revokeReason} onChange={e => setRevokeReason(e.target.value)} placeholder="Motif du retrait (facultatif)" className="h-9" />
      </ConfirmModal>
    </div>
  )
}
