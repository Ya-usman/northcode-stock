'use client'

import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import { Loader2, Plus, Trash2, Check, Info, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import { withTimeout } from '@/lib/utils/with-timeout'
import type { AdminTier } from '@/lib/api/require-admin'

interface Config {
  enabled: boolean
  reward_percentage: number
  validation_days: number
  association_window_days: number
  max_referrals_per_day: number
  fraud_auto_hold: boolean
  eligible_plans: string[]
  eligible_countries: string[] | null
  min_payout_by_currency: Record<string, number>
}
interface Catalog {
  plans: Array<{ id: string; name: string }>
  countries: Array<{ code: string; name: string; flag: string }>
  currencies: Array<{ code: string; symbol: string; label: string }>
}
type PayoutRow = { code: string; amount: string }

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

export function ReferralConfigForm({ tier }: { tier: AdminTier }) {
  const { toast } = useToast()
  const canWrite = tier === 'super_admin'

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [initial, setInitial] = useState<Config | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [payoutRows, setPayoutRows] = useState<PayoutRow[]>([])
  const [allCountries, setAllCountries] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/config'))
      if (!res.ok) throw new Error()
      const json = await res.json()
      const c: Config = json.config
      setCatalog(json.catalog)
      setInitial(c)
      setCfg(c)
      setUpdatedAt(json.updated_at)
      setAllCountries(c.eligible_countries === null)
      setPayoutRows(Object.entries(c.min_payout_by_currency).map(([code, amount]) => ({ code, amount: String(amount) })))
    } catch {
      toast({ title: 'Chargement impossible', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  // Devise -> minimum, reconstruit depuis les lignes éditables
  const payoutRecord = useMemo(() => {
    const out: Record<string, number> = {}
    for (const r of payoutRows) {
      if (!r.code) continue
      out[r.code] = Number(r.amount)
    }
    return out
  }, [payoutRows])

  const draft: Config | null = useMemo(() => {
    if (!cfg) return null
    return {
      ...cfg,
      eligible_countries: allCountries ? null : (cfg.eligible_countries ?? []),
      min_payout_by_currency: payoutRecord,
    }
  }, [cfg, allCountries, payoutRecord])

  const dirty = useMemo(
    () => !!initial && !!draft && JSON.stringify(initial) !== JSON.stringify(draft),
    [initial, draft],
  )

  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setCfg((prev) => (prev ? { ...prev, [key]: value } : prev))

  const togglePlan = (id: string) => {
    if (!cfg) return
    const has = cfg.eligible_plans.includes(id)
    set('eligible_plans', has ? cfg.eligible_plans.filter((p) => p !== id) : [...cfg.eligible_plans, id])
  }

  const toggleCountry = (code: string) => {
    if (!cfg) return
    const list = cfg.eligible_countries ?? []
    const has = list.includes(code)
    set('eligible_countries', has ? list.filter((c) => c !== code) : [...list, code])
  }

  const usedCodes = new Set(payoutRows.map((r) => r.code).filter(Boolean))
  const availableCurrencies = (catalog?.currencies ?? []).filter((c) => !usedCodes.has(c.code))

  const clientValidate = (): string | null => {
    if (!draft) return 'Configuration non chargée'
    if (draft.reward_percentage < 0.5 || draft.reward_percentage > 100) return 'Le pourcentage de récompense doit être entre 0,5 et 100'
    if (draft.validation_days < 0 || draft.validation_days > 365) return 'Le délai de validation doit être entre 0 et 365 jours'
    if (draft.max_referrals_per_day < 1 || draft.max_referrals_per_day > 1000) return 'Le plafond de filleuls / jour doit être entre 1 et 1000'
    if (draft.eligible_plans.length === 0) return 'Sélectionnez au moins un plan éligible'
    if (!allCountries && (draft.eligible_countries ?? []).length === 0) return 'Sélectionnez au moins un pays, ou activez « Tous les pays »'
    const seen = new Set<string>()
    for (const r of payoutRows) {
      if (!r.code) return 'Une ligne de minimum de retrait n\'a pas de devise'
      if (seen.has(r.code)) return `Devise en double : ${r.code}`
      seen.add(r.code)
      const n = Number(r.amount)
      if (!Number.isFinite(n) || n < 0) return `Montant invalide pour ${r.code}`
    }
    if (payoutRows.length === 0) return 'Renseignez au moins un minimum de retrait'
    return null
  }

  const save = async () => {
    const err = clientValidate()
    if (err) { toast({ title: err, variant: 'destructive' }); return }
    setSaving(true)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Enregistrement impossible', variant: 'destructive' }); return }
      toast({
        title: json.changed > 0 ? `✅ ${json.changed} paramètre(s) enregistré(s)` : 'Aucune modification',
        variant: 'success',
      })
      // Re-synchronise sur la config renvoyée par le serveur (source de vérité)
      const c: Config = json.config
      setInitial(c); setCfg(c); setUpdatedAt(new Date().toISOString())
      setAllCountries(c.eligible_countries === null)
      setPayoutRows(Object.entries(c.min_payout_by_currency).map(([code, amount]) => ({ code, amount: String(amount) })))
    } catch (e: any) {
      toast({ title: e?.message || 'Erreur réseau', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Chargement…</div>
  }
  if (!cfg || !catalog) {
    return <p className="text-sm text-muted-foreground py-12 text-center">Configuration indisponible.</p>
  }

  return (
    <div className="space-y-4 pb-24">
      {!canWrite && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
          <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
          Lecture seule — la modification de la configuration est réservée aux administrateurs complets.
        </div>
      )}

      {/* ── Programme ── */}
      <Section title="Programme" description="Activation globale et récompense de base">
        <Row label="Programme de parrainage actif" hint={cfg.enabled ? 'Les commerçants peuvent partager leur code et gagner des récompenses.' : 'Le programme est masqué et aucune nouvelle récompense n\'est créée.'}>
          <Switch checked={cfg.enabled} onCheckedChange={(v) => set('enabled', v)} disabled={!canWrite} />
        </Row>
        <Row label="Pourcentage de récompense" hint="Part du premier paiement réel du filleul reversée au parrain.">
          <div className="flex items-center gap-1.5">
            <Input
              type="number" step="0.5" min={0.5} max={100} disabled={!canWrite}
              value={cfg.reward_percentage}
              onChange={(e) => set('reward_percentage', Number(e.target.value))}
              className="w-24 h-9 text-right"
            />
            <span className="text-sm text-muted-foreground">%</span>
          </div>
        </Row>
      </Section>

      {/* ── Validation ── */}
      <Section title="Validation" description="Délai avant qu'un gain devienne disponible">
        <Row label="Délai avant disponibilité du gain" hint="Nombre de jours entre « en attente » et « disponible » après le paiement du filleul.">
          <div className="flex items-center gap-1.5">
            <Input type="number" min={0} max={365} disabled={!canWrite} value={cfg.validation_days}
              onChange={(e) => set('validation_days', Math.trunc(Number(e.target.value)))} className="w-24 h-9 text-right" />
            <span className="text-sm text-muted-foreground">jours</span>
          </div>
        </Row>
        {/* « Fenêtre d'association du code » : champ conservé en base pour une V2
            (rattacher un code après l'inscription), mais sans effet fonctionnel
            aujourd'hui — le code n'est saisi qu'au formulaire d'inscription —
            donc retiré de l'UI. Sa valeur est renvoyée telle quelle au serveur. */}
      </Section>

      {/* ── Éligibilité ── */}
      <Section title="Éligibilité" description="Quels abonnements et quels pays ouvrent droit à une récompense">
        <div>
          <p className="text-sm text-foreground mb-2">Plans éligibles</p>
          <div className="flex flex-wrap gap-2">
            {catalog.plans.map((p) => {
              const on = cfg.eligible_plans.includes(p.id)
              return (
                <button key={p.id} type="button" disabled={!canWrite} onClick={() => togglePlan(p.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'}`}>
                  {on && <Check className="h-3 w-3 text-primary" />}
                  {p.name}
                </button>
              )
            })}
          </div>
          {cfg.eligible_plans.length === 0 && (
            <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Aucun plan éligible : personne ne pourra générer de récompense.</p>
          )}
        </div>

        <div className="border-t border-border/60 pt-4">
          <Row label="Tous les pays éligibles" hint="Désactivez pour restreindre le programme à une liste de pays.">
            <Switch checked={allCountries} onCheckedChange={setAllCountries} disabled={!canWrite} />
          </Row>
          {!allCountries && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {catalog.countries.map((c) => {
                const on = (cfg.eligible_countries ?? []).includes(c.code)
                return (
                  <button key={c.code} type="button" disabled={!canWrite} onClick={() => toggleCountry(c.code)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:border-foreground/30'}`}
                    title={c.name}>
                    <span>{c.flag}</span>
                    <span className="font-medium">{c.code}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </Section>

      {/* ── Retraits ── */}
      <Section title="Retraits" description="Montant minimum d'une demande de retrait, par devise (code ISO — clé utilisée par les portefeuilles)">
        <div className="space-y-2">
          {payoutRows.map((row, i) => {
            const current = catalog.currencies.find((c) => c.code === row.code)
            const options = (current ? [current] : []).concat(availableCurrencies)
            return (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.code} disabled={!canWrite}
                  onChange={(e) => setPayoutRows((rows) => rows.map((r, j) => j === i ? { ...r, code: e.target.value } : r))}
                  className="h-9 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                >
                  {options.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
                <Input
                  type="number" min={0} step="any" disabled={!canWrite}
                  value={row.amount}
                  onChange={(e) => setPayoutRows((rows) => rows.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                  className="w-32 h-9 text-right"
                />
                {canWrite && (
                  <button type="button" onClick={() => setPayoutRows((rows) => rows.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-500 flex-shrink-0" title="Retirer">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {canWrite && availableCurrencies.length > 0 && (
          <Button variant="outline" size="sm" className="h-8 text-xs"
            onClick={() => setPayoutRows((rows) => [...rows, { code: availableCurrencies[0].code, amount: '0' }])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter une devise
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
          XOF (Afrique de l'Ouest) et XAF (Afrique centrale) sont distincts, bien qu'affichés « F CFA ».
        </p>
      </Section>

      {/* ── Sécurité / anti-fraude ── */}
      <Section title="Sécurité / anti-fraude" description="Contrôles automatiques sur les nouvelles associations de parrainage">
        <Row label="Mise en revue automatique des associations suspectes" hint="Un score multi-signaux (même appareil, email proche, vélocité…) retient les cas douteux : la récompense est créée mais n'est versée qu'après validation d'un administrateur.">
          <Switch checked={cfg.fraud_auto_hold} onCheckedChange={(v) => set('fraud_auto_hold', v)} disabled={!canWrite} />
        </Row>
        <Row label="Plafond de filleuls par parrain / 24 h" hint="Au-delà, les nouvelles associations du parrain sont retenues pour revue.">
          <Input type="number" min={1} max={1000} disabled={!canWrite} value={cfg.max_referrals_per_day}
            onChange={(e) => set('max_referrals_per_day', Math.trunc(Number(e.target.value)))} className="w-24 h-9 text-right" />
        </Row>
      </Section>

      {/* ── Barre d'enregistrement ── */}
      {canWrite && (
        <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-background/95 backdrop-blur border-t border-border flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {updatedAt ? `Dernière modification : ${new Date(updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </p>
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enregistrement…</> : 'Enregistrer les modifications'}
          </Button>
        </div>
      )}
    </div>
  )
}
