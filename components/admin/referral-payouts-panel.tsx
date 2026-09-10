'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Wallet, Clock, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { formatNaira } from '@/lib/utils/currency'
import { withTimeout } from '@/lib/utils/with-timeout'
import { KpiTile } from '@/components/admin/ui/kpi-tile'
import type { AdminTier } from '@/lib/api/require-admin'

interface PayoutRequest {
  id: string
  user_id: string
  user_email: string | null
  amount: number
  currency: string
  method: string | null
  payment_details: any
  status: string
  created_at: string
  reviewed_at: string | null
  paid_at: string | null
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  requested:    { label: 'En attente',      color: 'bg-amber-500/15 text-amber-400' },
  under_review: { label: 'En cours d\'examen', color: 'bg-blue-500/15 text-blue-400' },
  approved:     { label: 'Approuvé',        color: 'bg-blue-500/15 text-blue-400' },
  paid:         { label: 'Payé',            color: 'bg-green-500/15 text-green-400' },
  rejected:     { label: 'Rejeté',          color: 'bg-red-500/15 text-red-400' },
  cancelled:    { label: 'Annulé',          color: 'bg-muted text-muted-foreground' },
}

const FILTERS = [
  { value: 'requested', label: 'En attente' },
  { value: 'under_review', label: 'En examen' },
  { value: 'approved', label: 'Approuvés' },
  { value: 'paid', label: 'Payés' },
  { value: 'all', label: 'Tous' },
]

// Transitions proposées selon le statut courant
const NEXT_ACTIONS: Record<string, Array<{ status: string; label: string; variant?: 'destructive' }>> = {
  requested:    [{ status: 'under_review', label: 'Mettre en examen' }, { status: 'rejected', label: 'Rejeter', variant: 'destructive' }],
  under_review: [{ status: 'approved', label: 'Approuver' }, { status: 'rejected', label: 'Rejeter', variant: 'destructive' }],
  approved:     [{ status: 'paid', label: 'Marquer payé' }, { status: 'rejected', label: 'Rejeter', variant: 'destructive' }],
}

export function ReferralPayoutsPanel({ tier }: { tier: AdminTier }) {
  const { toast } = useToast()
  const canWrite = tier === 'super_admin'
  const [requests, setRequests] = useState<PayoutRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('requested')
  const [acting, setActing] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await withTimeout(fetch(`/api/admin/referrals/payouts?status=${filter}`))
      const json = await res.json()
      if (res.ok) setRequests(json.requests || [])
    } catch {
      // garde la liste précédente
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const resolve = async (requestId: string, status: string) => {
    setActing(requestId)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, status }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Action impossible', variant: 'destructive' }); return }
      toast({ title: '✅ Demande mise à jour', variant: 'success' })
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setActing(null)
    }
  }

  // KPIs — sur la liste chargée (filtre "Tous" pour une vue complète)
  const pendingCount = requests.filter(r => ['requested', 'under_review', 'approved'].includes(r.status)).length
  const pendingAmount = requests.filter(r => ['requested', 'under_review', 'approved'].includes(r.status)).reduce((s, r) => s + Number(r.amount), 0)
  const paidAmount = requests.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <KpiTile label="Demandes en cours" value={pendingCount} icon={Clock} tone={pendingCount > 0 ? 'warning' : 'default'} />
        <KpiTile label="Montant en attente" value={formatNaira(pendingAmount)} icon={Wallet} tone="default" />
        <KpiTile label="Total payé (vue actuelle)" value={formatNaira(paidAmount)} icon={CheckCircle2} tone="success" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-muted-foreground hover:text-foreground" title="Actualiser">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading && requests.length === 0 ? (
          <p className="px-5 py-10 text-center text-muted-foreground text-sm">Chargement…</p>
        ) : requests.length === 0 ? (
          <p className="px-5 py-10 text-center text-muted-foreground text-sm">Aucune demande</p>
        ) : (
          <div className="divide-y divide-border/50">
            {requests.map(r => {
              const st = STATUS_LABELS[r.status] || { label: r.status, color: 'bg-muted text-muted-foreground' }
              const actions = NEXT_ACTIONS[r.status] || []
              const details = typeof r.payment_details === 'object' && r.payment_details?.note
                ? r.payment_details.note
                : (typeof r.payment_details === 'string' ? r.payment_details : '')
              return (
                <div key={r.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-foreground">{formatNaira(r.amount)}</span>
                      <span className="text-xs text-muted-foreground">{r.currency}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.user_email || r.user_id}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.method || '—'}{details ? ` · ${details}` : ''} · {new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  {canWrite && actions.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {actions.map(a => (
                        <Button
                          key={a.status}
                          size="sm"
                          variant={a.variant === 'destructive' ? 'outline' : 'outline'}
                          disabled={acting === r.id}
                          onClick={() => resolve(r.id, a.status)}
                          className={a.variant === 'destructive' ? 'border-red-700 text-red-400 hover:bg-red-900/30 h-7 text-xs' : 'h-7 text-xs'}
                        >
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
