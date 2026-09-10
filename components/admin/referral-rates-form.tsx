'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Info, RefreshCw, RotateCcw, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { AdminTier } from '@/lib/api/require-admin'

type Freshness = 'fresh' | 'stale' | 'very_stale' | 'unknown'
interface RateRow {
  code: string
  symbol: string
  label: string
  rate: number | null
  provider: string | null
  effective_date: string | null
  fetched_at: string | null
  is_manual_override: boolean
  freshness: Freshness
}

const FRESH_BADGE: Record<Freshness, { label: string; cls: string }> = {
  fresh:      { label: 'à jour',      cls: 'bg-green-500/15 text-green-500' },
  stale:      { label: 'ancien',      cls: 'bg-amber-500/15 text-amber-500' },
  very_stale: { label: 'trop ancien', cls: 'bg-red-500/15 text-red-500' },
  unknown:    { label: 'inconnu',     cls: 'bg-muted text-muted-foreground' },
}
const PROVIDER_LABEL: Record<string, string> = {
  frankfurter: 'Frankfurter (BCE)',
  'er-api': 'ExchangeRate-API',
  manual: 'Manuel',
  seed: 'Valeur initiale',
  manual_seed: 'Valeur initiale',
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

// Taux de change pour le REPORTING agrégé uniquement — ne modifie aucun
// montant stocké. Sources : Frankfurter (BCE) puis ExchangeRate-API.
export function ReferralRatesForm({ tier }: { tier: AdminTier }) {
  const { toast } = useToast()
  const canWrite = tier === 'super_admin'

  const [pivot, setPivot] = useState('USD')
  const [rows, setRows] = useState<RateRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [clearing, setClearing] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/rates'))
      if (!res.ok) throw new Error()
      const json = await res.json()
      setPivot(json.pivot)
      setRows(json.currencies || [])
      const d: Record<string, string> = {}
      for (const c of json.currencies || []) d[c.code] = c.rate != null ? String(c.rate) : ''
      setDraft(d)
    } catch {
      toast({ title: 'Chargement des taux impossible', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  const dirty = rows.some((r) => (draft[r.code] ?? '') !== (r.rate != null ? String(r.rate) : ''))
  const oldest = rows.reduce<string | null>((min, r) => {
    const d = r.effective_date || r.fetched_at
    return d && (!min || d < min) ? d : min
  }, null)
  const anyVeryStale = rows.some((r) => r.freshness === 'very_stale')

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }),
      }), 20000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Actualisation impossible', variant: 'destructive' }); return }
      const parts = [`${json.updated} taux`]
      if (json.skipped) parts.push(`${json.skipped} override(s) conservé(s)`)
      if (json.missing?.length) parts.push(`sans taux : ${json.missing.join(', ')}`)
      toast({ title: `✅ ${parts.join(' · ')}`, variant: 'success' })
      await load()
    } catch (e: any) {
      toast({ title: e?.message || 'Erreur réseau', variant: 'destructive' })
    } finally {
      setRefreshing(false)
    }
  }

  const clearOverride = async (currency: string) => {
    setClearing(currency)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/rates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'clear_override', currency }),
      }), 20000)
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Impossible', variant: 'destructive' }); return }
      toast({ title: `✅ ${currency} : retour au taux automatique`, variant: 'success' })
      await load()
    } catch (e: any) {
      toast({ title: e?.message || 'Erreur réseau', variant: 'destructive' })
    } finally {
      setClearing(null)
    }
  }

  const save = async () => {
    const payload: Array<{ currency: string; rate: number }> = []
    for (const r of rows) {
      const raw = (draft[r.code] ?? '').trim()
      const orig = r.rate != null ? String(r.rate) : ''
      if (raw === orig) continue
      if (!raw) continue
      const n = Number(raw.replace(',', '.'))
      if (!Number.isFinite(n) || n <= 0) { toast({ title: `Taux invalide pour ${r.code}`, variant: 'destructive' }); return }
      payload.push({ currency: r.code, rate: n })
    }
    if (payload.length === 0) { toast({ title: 'Aucune modification', variant: 'destructive' }); return }
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/rates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rates: payload }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Enregistrement impossible', variant: 'destructive' }); return }
      toast({ title: json.changed > 0 ? `✅ ${json.changed} taux manuel(s) enregistré(s)` : 'Aucune modification', variant: 'success' })
      await load()
    } catch (e: any) {
      toast({ title: e?.message || 'Erreur réseau', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Taux de change (reporting)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Convertissent uniquement les KPI agrégés vers une devise de reporting. Ne modifient
            aucun montant enregistré. Exprimés « 1 devise = X {pivot} ». Sources : Frankfurter (BCE), puis ExchangeRate-API.
          </p>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing} className="h-8 text-xs flex-shrink-0">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            Actualiser les taux
          </Button>
        )}
      </div>

      {(oldest || anyVeryStale) && (
        <p className={`text-[11px] flex items-start gap-1.5 ${anyVeryStale ? 'text-red-500' : 'text-amber-600 dark:text-amber-400'}`}>
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          {anyVeryStale
            ? "Certains taux sont trop anciens — lancez « Actualiser les taux » ou saisissez un taux manuel."
            : `Taux les plus anciens du ${fmtDate(oldest)}.`}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-muted-foreground text-left">
              <th className="pb-2 font-medium">Devise</th>
              <th className="pb-2 font-medium text-right">1 devise = ? {pivot}</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Mis à jour</th>
              <th className="pb-2 font-medium">Statut</th>
              {canWrite && <th className="pb-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {rows.map((r) => (
              <tr key={r.code}>
                <td className="py-2 pr-3 whitespace-nowrap">
                  <span className="font-mono font-semibold">{r.code}</span>{' '}
                  <span className="text-muted-foreground text-xs">({r.symbol})</span>
                </td>
                <td className="py-2 pl-3 text-right">
                  <Input
                    type="number" step="any" min={0} disabled={!canWrite}
                    value={draft[r.code] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.code]: e.target.value }))}
                    className="w-28 h-8 text-right inline-block"
                  />
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                  {PROVIDER_LABEL[r.provider || ''] || r.provider || '—'}
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap" title={r.fetched_at ? `Récupéré le ${new Date(r.fetched_at).toLocaleString('fr-FR')}` : ''}>
                  {fmtDate(r.effective_date || r.fetched_at)}
                </td>
                <td className="py-2 px-3 whitespace-nowrap">
                  {r.is_manual_override ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500">
                      <Lock className="h-2.5 w-2.5" /> Manuel (override)
                    </span>
                  ) : (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${FRESH_BADGE[r.freshness].cls}`}>
                      Auto · {FRESH_BADGE[r.freshness].label}
                    </span>
                  )}
                </td>
                {canWrite && (
                  <td className="py-2 pl-3 text-right">
                    {r.is_manual_override && (
                      <button
                        onClick={() => clearOverride(r.code)}
                        disabled={clearing === r.code}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                        title="Revenir au taux automatique"
                      >
                        {clearing === r.code ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        Auto
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            Modifier un taux ci-dessus le fige en <span className="font-semibold">override manuel</span> (prioritaire sur l'actualisation automatique).
          </p>
          <Button onClick={save} disabled={!dirty || saving} size="sm" className="flex-shrink-0">
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enregistrement…</> : 'Enregistrer les taux manuels'}
          </Button>
        </div>
      )}
    </div>
  )
}
