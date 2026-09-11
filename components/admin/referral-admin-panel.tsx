'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Search, Gift, Users, TrendingUp, Wallet, CreditCard, Banknote, Ban, Snowflake, Sun, X, Loader2, ShieldAlert, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { formatCurrency } from '@/lib/utils/currency'
import { currencySymbol, REFERRAL_CURRENCIES } from '@/lib/saas/currencies'
import { convertByCurrency, type RateMap } from '@/lib/saas/exchange'
import { withTimeout } from '@/lib/utils/with-timeout'
import { DEFAULT_REPORTING_CURRENCY } from '@/lib/hooks/use-reporting-currency'
import { KpiTile } from '@/components/admin/ui/kpi-tile'
import { MoneyTile } from '@/components/admin/money-by-currency'
import type { AdminTier } from '@/lib/api/require-admin'

type ByCurrency = Record<string, number>
const REPORT_CCY_KEY = 'referral_report_currency'

interface Overview {
  active_codes: number
  total_referrals: number
  converted: number
  conversion_rate: number
  pending_payouts: number
  rewards_total: ByCurrency
  rewards_available: ByCurrency
  rewards_pending: ByCurrency
  credit_used: ByCurrency
  withdrawn: ByCurrency
  revenue_generated: ByCurrency
}

interface LookupResult {
  found: boolean
  owner?: { user_id: string; full_name: string | null; email: string | null }
  code?: { id: string; code: string; active: boolean } | null
  wallet?: { id: string; currency: string; frozen: boolean; available_balance: number; pending_balance: number } | null
  referrals?: Array<{ id: string; shop_name: string; status: string; registered_at: string; reward: { id: string; amount: number; currency: string; status: string } | null }>
  payouts?: Array<{ id: string; amount: number; currency: string; status: string; created_at: string }>
}

interface ReviewItem {
  id: string
  status: string
  registered_at: string
  risk_flags: Array<{ code: string; detail?: string }>
  referrer: { user_id: string; full_name: string | null; email: string | null; code: string | null }
  referred: { user_id: string; full_name: string | null; email: string | null; shop_name: string }
  reward: { amount: number; currency: string; status: string } | null
}

const FLAG_LABELS: Record<string, string> = {
  same_ip: 'Même IP',
  same_phone: 'Même téléphone',
  similar_email: 'Email similaire',
  referrer_too_new: 'Parrain très récent',
  velocity: 'Trop de filleuls / 24h',
  disposable_email: 'Email jetable',
}

export function ReferralAdminPanel({ tier, locale }: { tier: AdminTier; locale: string }) {
  const { toast } = useToast()
  const canWrite = tier === 'super_admin'
  const [overview, setOverview] = useState<Overview | null>(null)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<LookupResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [acting, setActing] = useState(false)
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [rates, setRates] = useState<RateMap>({})
  // XAF par défaut (politique de devise StockShop — reporting piloté depuis
  // le Cameroun) ; « Par devise » reste sélectionnable pour voir la
  // ventilation brute sans conversion. Préférence propre à ce panneau
  // (REPORT_CCY_KEY) — volontairement distincte du sélecteur XAF partagé
  // de Command Center/Analytics/Facturation/Agents, qui n'a pas de mode
  // "aucune conversion".
  const [reportCcy, setReportCcy] = useState<string>(DEFAULT_REPORTING_CURRENCY)

  const loadReview = () => {
    withTimeout(fetch('/api/admin/referrals/review')).then(async r => {
      if (r.ok) setReviewItems((await r.json()).referrals || [])
    }).catch(() => {})
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REPORT_CCY_KEY)
      if (saved) setReportCcy(saved)
    } catch { /* localStorage indisponible */ }

    withTimeout(fetch('/api/admin/referrals/overview')).then(async r => {
      if (r.ok) setOverview(await r.json())
    }).catch(() => {})
    withTimeout(fetch('/api/admin/exchange-rates')).then(async r => {
      if (r.ok) setRates((await r.json()).rates || {})
    }).catch(() => {})
    loadReview()
  }, [])

  const setReport = (v: string) => {
    setReportCcy(v)
    try { localStorage.setItem(REPORT_CCY_KEY, v) } catch { /* ignore */ }
  }

  // Conversion cosmétique pour le reporting — ne touche à aucune donnée
  // source. « by_currency » = ventilation d'origine (aucune conversion).
  const converting = reportCcy !== 'by_currency'
  const convertTile = (amounts: ByCurrency): { amounts: ByCurrency; missing: string[]; asOf: string | null } => {
    if (!converting) return { amounts, missing: [], asOf: null }
    const { value, missing, oldest_as_of } = convertByCurrency(amounts, reportCcy, rates)
    return { amounts: { [reportCcy]: value }, missing, asOf: oldest_as_of }
  }
  const convMeta = converting && overview
    ? convertByCurrency(
        {
          ...overview.rewards_total, ...overview.rewards_available, ...overview.rewards_pending,
          ...overview.credit_used, ...overview.withdrawn, ...overview.revenue_generated,
        },
        reportCcy, rates,
      )
    : null
  const anyMissing = convMeta?.missing ? Array.from(new Set(convMeta.missing)) : []
  const convAsOf = convMeta?.oldest_as_of ?? null
  const convStale = convMeta?.worst_freshness === 'stale' || convMeta?.worst_freshness === 'very_stale'
  const convSources = converting
    ? Array.from(new Set(
        Object.values(rates).map((r) => r.provider).filter(Boolean).map((p) =>
          p === 'frankfurter' ? 'Frankfurter' : p === 'er-api' ? 'ExchangeRate-API' : p === 'manual' ? 'taux manuel' : String(p)),
      ))
    : []

  const review = async (referralId: string, decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !window.confirm('Rejeter ce parrainage ? Toute récompense en attente sera annulée.')) return
    setReviewing(referralId)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referral_id: referralId, decision }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Action impossible', variant: 'destructive' }); return }
      toast({ title: decision === 'approve' ? '✅ Parrainage approuvé' : '✅ Parrainage rejeté', variant: 'success' })
      setReviewItems(prev => prev.filter(i => i.id !== referralId))
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setReviewing(null)
    }
  }

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setResult(null)
    try {
      const res = await withTimeout(fetch(`/api/admin/referrals/lookup?q=${encodeURIComponent(query.trim())}`))
      const json = await res.json()
      if (res.ok) setResult(json)
      else toast({ title: json.error || 'Erreur', variant: 'destructive' })
    } catch {
      toast({ title: 'Recherche impossible', variant: 'destructive' })
    } finally {
      setSearching(false)
    }
  }

  const moderate = async (payload: Record<string, any>) => {
    setActing(true)
    try {
      const res = await withTimeout(fetch('/api/admin/referrals/moderate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error || 'Action impossible', variant: 'destructive' }); return }
      toast({ title: '✅ Effectué', variant: 'success' })
      search() // rafraîchit le résultat
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setActing(false)
    }
  }

  const adjustWallet = () => {
    if (!result?.owner) return
    const raw = window.prompt('Montant de l\'ajustement (+ pour créditer, - pour débiter) :')
    if (raw === null) return
    const amount = Number(raw.replace(',', '.'))
    if (!Number.isFinite(amount) || amount === 0) { toast({ title: 'Montant invalide', variant: 'destructive' }); return }
    const reason = window.prompt('Motif de l\'ajustement :')
    if (!reason?.trim()) { toast({ title: 'Motif requis', variant: 'destructive' }); return }
    moderate({ action: 'adjust_wallet', user_id: result.owner.user_id, amount, reason: reason.trim() })
  }

  const cancelReward = (rewardId: string) => {
    const reason = window.prompt('Motif de l\'annulation de cette récompense :')
    if (reason === null) return
    moderate({ action: 'cancel_reward', reward_id: rewardId, reason: reason.trim() })
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      {overview && (
        <>
          {/* Compteurs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile label="Codes actifs" value={overview.active_codes} icon={Gift} tone="default" />
            <KpiTile label="Filleuls" value={overview.total_referrals} icon={Users} tone="default" />
            <KpiTile label="Taux de conversion" value={`${overview.conversion_rate}%`} icon={TrendingUp} tone={overview.conversion_rate >= 20 ? 'success' : 'default'} />
            <KpiTile label="Demandes de retrait en attente" value={overview.pending_payouts} icon={Banknote} tone={overview.pending_payouts > 0 ? 'warning' : 'default'} />
          </div>
          {/* Montants — ventilés par devise (jamais additionnés) ou convertis
              vers une devise de reporting choisie (conversion cosmétique). */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Montants</p>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Devise de reporting
              <select
                value={reportCcy}
                onChange={(e) => setReport(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value="by_currency">Par devise (aucune conversion)</option>
                {REFERRAL_CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.symbol}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {([
              ['Récompenses totales', overview.rewards_total, Wallet, 'default'],
              ['Récompenses disponibles', overview.rewards_available, Wallet, 'success'],
              ['Récompenses en attente', overview.rewards_pending, Wallet, 'warning'],
              ['Utilisé sur abonnements', overview.credit_used, CreditCard, 'default'],
              ['Total retiré', overview.withdrawn, Banknote, 'default'],
              ['Revenu généré par le programme', overview.revenue_generated, TrendingUp, 'success'],
            ] as Array<[string, ByCurrency, typeof Wallet, 'default' | 'success' | 'warning']>).map(([label, amounts, Icon, tone]) => (
              <MoneyTile key={label} label={label} amounts={convertTile(amounts).amounts} icon={Icon} tone={tone} approx={converting} />
            ))}
          </div>

          {converting && (
            <div className="text-[11px] text-muted-foreground space-y-1">
              <p title={convAsOf ? `Taux daté du ${new Date(convAsOf).toLocaleString('fr-FR')}` : undefined}>
                <span className="font-medium">≈</span> Montants convertis à titre de reporting selon les taux enregistrés
                {convAsOf && <> · taux mis à jour le {new Date(convAsOf).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                {convSources.length > 0 && <> · source : {convSources.join(', ')}</>}.
              </p>
              {convStale && (
                <p className="text-amber-600 dark:text-amber-400">
                  Certains taux sont anciens — l'admin peut les actualiser dans Configuration → Taux de change.
                </p>
              )}
              {anyMissing.length > 0 && (
                <p className="text-amber-600 dark:text-amber-400">
                  Conversion partielle — devise(s) sans taux exclue(s) du total : {anyMissing.join(', ')}.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* Filleuls à vérifier (anti-fraude) */}
      {reviewItems.length > 0 && (
        <div className="bg-card rounded-xl border border-amber-500/40 shadow-sm p-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            Filleuls à vérifier
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500">{reviewItems.length}</span>
          </h3>
          <p className="text-xs text-muted-foreground">
            Associations retenues par l'analyse anti-fraude. La récompense est créée mais ne sera versée qu'après approbation.
          </p>
          <div className="divide-y divide-border/50">
            {reviewItems.map(item => (
              <div key={item.id} className="py-3 space-y-2 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 text-xs space-y-0.5">
                    <p className="text-foreground">
                      <span className="text-muted-foreground">Parrain :</span> {item.referrer.full_name || '—'}
                      {item.referrer.code && <span className="font-mono ml-1.5">{item.referrer.code}</span>}
                    </p>
                    <p className="text-muted-foreground truncate">{item.referrer.email}</p>
                    <p className="text-foreground pt-1">
                      <span className="text-muted-foreground">Filleul :</span> {item.referred.shop_name} · {item.referred.email}
                    </p>
                    {item.reward && (
                      <p className="text-green-400 font-semibold pt-0.5">Récompense en attente : +{formatCurrency(item.reward.amount, currencySymbol(item.reward.currency))}</p>
                    )}
                  </div>
                  {canWrite && (
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Button
                        size="sm" variant="outline" disabled={reviewing === item.id}
                        onClick={() => review(item.id, 'approve')}
                        className="h-7 text-xs border-green-700 text-green-400 hover:bg-green-900/30"
                      >
                        {reviewing === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" />Approuver</>}
                      </Button>
                      <Button
                        size="sm" variant="outline" disabled={reviewing === item.id}
                        onClick={() => review(item.id, 'reject')}
                        className="h-7 text-xs border-red-700 text-red-400 hover:bg-red-900/30"
                      >
                        <X className="h-3 w-3 mr-1" />Rejeter
                      </Button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.risk_flags.map((f, i) => (
                    <span key={i} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500" title={f.detail || ''}>
                      {FLAG_LABELS[f.code] || f.code}{f.detail ? ` (${f.detail})` : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recherche de code */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Recherche de code</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Code de parrainage ou email du propriétaire"
              className="pl-8 h-9"
            />
          </div>
          <Button size="sm" onClick={search} disabled={searching} className="h-9">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rechercher'}
          </Button>
        </div>

        {result && !result.found && (
          <p className="text-sm text-muted-foreground py-4 text-center">Aucun résultat</p>
        )}

        {result?.found && result.owner && (
          <div className="border border-border rounded-lg p-4 space-y-4">
            {/* Propriétaire + code */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-foreground">{result.owner.full_name || '—'}</p>
                <p className="text-xs text-muted-foreground">{result.owner.email || result.owner.user_id}</p>
                {result.code && (
                  <p className="text-xs mt-1">
                    <span className="font-mono font-bold">{result.code.code}</span>
                    <span className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${result.code.active ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}>
                      {result.code.active ? 'Actif' : 'Suspendu'}
                    </span>
                  </p>
                )}
              </div>
              {canWrite && result.code && (
                <Button
                  size="sm" variant="outline" disabled={acting}
                  onClick={() => moderate({ action: result.code!.active ? 'suspend_code' : 'reactivate_code', code_id: result.code!.id })}
                  className={result.code.active ? 'border-red-700 text-red-400 hover:bg-red-900/30 h-7 text-xs' : 'h-7 text-xs'}
                >
                  <Ban className="h-3 w-3 mr-1" />
                  {result.code.active ? 'Suspendre le code' : 'Réactiver le code'}
                </Button>
              )}
            </div>

            {/* Portefeuille */}
            {result.wallet && (
              <div className="bg-muted/40 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs text-muted-foreground">Portefeuille {result.wallet.frozen && <span className="text-red-400 font-semibold">· GELÉ</span>}</p>
                  <p className="text-sm font-bold text-foreground">
                    {formatCurrency(result.wallet.available_balance, currencySymbol(result.wallet.currency))} <span className="text-xs font-normal text-muted-foreground">dispo</span>
                    {result.wallet.pending_balance > 0 && <span className="text-xs font-normal text-amber-400 ml-2">+ {formatCurrency(result.wallet.pending_balance, currencySymbol(result.wallet.currency))} en attente</span>}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" disabled={acting} onClick={adjustWallet} className="h-7 text-xs">Ajuster</Button>
                    <Button
                      size="sm" variant="outline" disabled={acting}
                      onClick={() => moderate({ action: result.wallet!.frozen ? 'unfreeze_wallet' : 'freeze_wallet', wallet_id: result.wallet!.id })}
                      className={result.wallet.frozen ? 'h-7 text-xs' : 'border-red-700 text-red-400 hover:bg-red-900/30 h-7 text-xs'}
                    >
                      {result.wallet.frozen ? <Sun className="h-3 w-3 mr-1" /> : <Snowflake className="h-3 w-3 mr-1" />}
                      {result.wallet.frozen ? 'Dégeler' : 'Geler'}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Filleuls */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Filleuls ({result.referrals?.length ?? 0})</p>
              {(!result.referrals || result.referrals.length === 0) ? (
                <p className="text-xs text-muted-foreground">Aucun filleul</p>
              ) : (
                <div className="space-y-1.5">
                  {result.referrals.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-border/40 last:border-0">
                      <div className="min-w-0">
                        <Link href={`/${locale}/admin/shops`} className="text-foreground hover:text-blue-400">{r.shop_name}</Link>
                        <span className="text-muted-foreground ml-2">{new Date(r.registered_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-muted-foreground">{r.status}</span>
                        {r.reward && (
                          <>
                            <span className={`font-semibold ${r.reward.status === 'reversed' ? 'text-muted-foreground line-through' : 'text-green-400'}`}>
                              +{formatCurrency(r.reward.amount, currencySymbol(r.reward.currency))}
                            </span>
                            {canWrite && r.reward.status !== 'reversed' && (
                              <button onClick={() => cancelReward(r.reward!.id)} className="text-red-400 hover:underline" title="Annuler la récompense">
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Retraits */}
            {result.payouts && result.payouts.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Retraits</p>
                <div className="space-y-1">
                  {result.payouts.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-xs py-1">
                      <span className="text-muted-foreground">
                        {new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })} · {formatCurrency(p.amount, currencySymbol(p.currency))}
                      </span>
                      <span className="text-muted-foreground">{p.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
