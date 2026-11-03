'use client'

// « Écarts de pays » (migration 208, 3 nov. 2026) — page Facturation de l'admin. Entreprises dont le pays déclaré,
// l'activité réelle (30 jours) et les paiements ne concordent pas ; pays de tarification fixé à la main (super_admin,
// motif obligatoire, journal). Personne n'est jamais bloqué : seul le prix du prochain paiement peut changer.
// Console interne en français (comme le reste de l'admin).

import { useCallback, useEffect, useState } from 'react'
import { Globe2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import { COUNTRIES } from '@/lib/saas/countries'

interface Row {
  id: string; name: string | null; plan: string; internal: boolean
  declared: string; pricing_country: string; reason: 'declared' | 'activity' | 'override'
  override: { country: string; reason: string; at: string } | null
  activity: { country: string; ops: number; logins: number }[]
  activity_country: string | null; activity_share: number; activity_ops: number
  reviews: { at: string; payer_country?: string; request_country?: string; pricing_country?: string }[]
}

const name = (c: string | null | undefined) => (c ? `${(COUNTRIES as any)[c]?.name ?? c} (${c})` : 'aucun')
const REASON = { declared: 'pays déclaré', activity: 'activité réelle', override: 'fixé par l’équipe' } as const

export function PricingCountriesPanel() {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [edit, setEdit] = useState<{ id: string; country: string; reason: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await withTimeout(fetch('/api/admin/pricing-countries')).catch(() => null)
    if (!res || !res.ok) { setRows([]); return }
    setRows((await res.json()).rows || [])
  }, [])
  useEffect(() => { load() }, [load])

  const send = async (method: 'POST' | 'DELETE', body: Record<string, string>) => {
    setBusy(true)
    try {
      const res = await withTimeout(fetch('/api/admin/pricing-countries', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: json.error || 'Action refusée', variant: 'destructive' }); return }
      toast({ title: method === 'POST' ? 'Pays de tarification fixé' : 'Retour à la règle automatique', variant: 'success' })
      setEdit(null); await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4" data-testid="pricing-countries-panel">
      <div className="mb-1 flex items-center gap-2">
        <Globe2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Écarts de pays</h3>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Le prix suit le pays où la boutique fonctionne (au moins 70 % des ventes, entrées de stock et inventaires des 30 derniers jours,
        dans une zone plus chère). Un paiement depuis l’étranger seul ne change rien. Personne n’est bloqué.
      </p>
      {rows === null ? <p className="text-xs text-muted-foreground">Chargement…</p> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pricing-countries-empty">Aucun écart.</p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map(r => (
            <div key={r.id} className="py-3 text-sm" data-testid="pricing-country-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">{r.name || r.id}{r.internal ? ' · interne' : ''} <span className="text-xs text-muted-foreground">· {r.plan}</span></p>
                <p className="text-xs">Tarif : <strong>{name(r.pricing_country)}</strong> ({REASON[r.reason]})</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Déclaré : {name(r.declared)} · Activité (30 j) : {r.activity_ops > 0
                  ? r.activity.slice(0, 3).map(a => `${a.country} ${a.ops}`).join(', ') + (r.activity_country ? ` · majoritaire ${r.activity_country} à ${r.activity_share} %` : ' · trop peu d’opérations')
                  : 'aucune'}
              </p>
              {r.override && <p className="mt-0.5 text-xs text-muted-foreground">Fixé : {name(r.override.country)}, « {r.override.reason} »</p>}
              {r.reviews.length > 0 && (
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {r.reviews.length} paiement(s) à vérifier : carte {r.reviews[0].payer_country ?? '?'}, demande {r.reviews[0].request_country ?? '?'}, tarif {r.reviews[0].pricing_country ?? '?'}
                </p>
              )}
              {edit?.id === r.id ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={edit.country} onChange={e => setEdit({ ...edit, country: e.target.value })}>
                    {Object.values(COUNTRIES).map(c => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                  </select>
                  <Input className="h-9 w-64" placeholder="Motif (obligatoire)" value={edit.reason} onChange={e => setEdit({ ...edit, reason: e.target.value })} />
                  <Button size="sm" disabled={busy || edit.reason.trim().length < 3} onClick={() => send('POST', { entity_id: r.id, country: edit.country, reason: edit.reason })}>Fixer</Button>
                  {r.override && <Button size="sm" variant="outline" disabled={busy || edit.reason.trim().length < 3} onClick={() => send('DELETE', { entity_id: r.id, reason: edit.reason })}>Revenir à la règle</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Annuler</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setEdit({ id: r.id, country: r.pricing_country, reason: '' })}>Fixer le pays de tarification</Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
