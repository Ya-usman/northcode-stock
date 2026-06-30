'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  ShieldOff, ShieldCheck, Clock, CreditCard, Search,
  ChevronDown, ChevronUp, ExternalLink, Activity, MoreVertical,
  CheckSquare, Square, X, Loader2,
} from 'lucide-react'
import { ShopRestorePanel } from '@/components/admin/shop-restore-panel'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

function healthScore(owner: { last_seen: string | null } | null, subscribed: boolean) {
  const lastSeen = owner?.last_seen ? new Date(owner.last_seen) : null
  const days = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 86400000) : 999
  let score = 0
  if (days <= 7) score += 30
  else if (days <= 14) score += 15
  if (subscribed) score += 40
  else score += 10
  if (days <= 30) score += 20
  else if (days <= 60) score += 10
  return Math.min(100, score)
}

interface Shop {
  id: string
  name: string
  city: string
  country?: string
  currency?: string
  plan: string | null
  trial_ends_at: string | null
  plan_expires_at: string | null
  created_at: string
  whatsapp: string | null
  owner: { full_name: string; is_active: boolean; last_seen: string | null } | null
  subscriptions: { amount: number; plan: string; status: string; created_at: string; paystack_reference: string | null }[]
}

interface Props {
  shops: Shop[]
  locale: string
}



type ActionType = 'suspend' | 'reactivate' | 'extend' | 'grant_plan'

const COUNTRY_LABELS: Record<string, { flag: string; name: string }> = {
  NG: { flag: '🇳🇬', name: 'Nigeria' },
  CM: { flag: '🇨🇲', name: 'Cameroun' },
  CI: { flag: '🇨🇮', name: "Côte d'Ivoire" },
  SN: { flag: '🇸🇳', name: 'Sénégal' },
  GH: { flag: '🇬🇭', name: 'Ghana' },
  NE: { flag: '🇳🇪', name: 'Niger' },
  ML: { flag: '🇲🇱', name: 'Mali' },
  BF: { flag: '🇧🇫', name: 'Burkina Faso' },
  BJ: { flag: '🇧🇯', name: 'Bénin' },
  TG: { flag: '🇹🇬', name: 'Togo' },
  GN: { flag: '🇬🇳', name: 'Guinée' },
  CD: { flag: '🇨🇩', name: 'RD Congo' },
  CG: { flag: '🇨🇬', name: 'Congo' },
  GA: { flag: '🇬🇦', name: 'Gabon' },
  TD: { flag: '🇹🇩', name: 'Tchad' },
  CF: { flag: '🇨🇫', name: 'Centrafrique' },
  GQ: { flag: '🇬🇶', name: 'Guinée Équatoriale' },
  MA: { flag: '🇲🇦', name: 'Maroc' },
  DZ: { flag: '🇩🇿', name: 'Algérie' },
  TN: { flag: '🇹🇳', name: 'Tunisie' },
  KE: { flag: '🇰🇪', name: 'Kenya' },
  ZA: { flag: '🇿🇦', name: 'Afrique du Sud' },
  FR: { flag: '🇫🇷', name: 'France' },
  GB: { flag: '🇬🇧', name: 'Royaume-Uni' },
  US: { flag: '🇺🇸', name: 'États-Unis' },
}

function countryLabel(code: string) {
  const c = COUNTRY_LABELS[code]
  return c ? `${c.flag} ${c.name}` : `🌐 ${code}`
}

const COLUMNS = [
  { key: 'shop',    label: 'Boutique / Propriétaire' },
  { key: 'city',    label: 'Ville' },
  { key: 'country', label: 'Pays' },
  { key: 'plan',    label: 'Plan' },
  { key: 'status',  label: 'Statut' },
  { key: 'expiry',  label: 'Expiration' },
  { key: 'revenue', label: 'Revenus' },
  { key: 'actions', label: 'Actions' },
]

function StatusBadge({ isSuspended, subscribed, trialDays }: { isSuspended: boolean; subscribed: boolean; trialDays: number }) {
  if (isSuspended)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full whitespace-nowrap">● Suspendu</span>
  if (subscribed)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full whitespace-nowrap">● Abonné</span>
  if (trialDays >= 0)
    return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full whitespace-nowrap">● Essai</span>
  return <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full whitespace-nowrap">● Expiré</span>
}

function ExpiryCell({ daysRemaining, isExpired }: { daysRemaining: number | null; isExpired: boolean }) {
  if (daysRemaining !== null)
    return (
      <span className={`text-xs font-medium ${daysRemaining <= 3 ? 'text-red-400' : daysRemaining <= 7 ? 'text-amber-400' : 'text-foreground'}`}>
        {daysRemaining === 0 ? "Expire auj." : `${daysRemaining}j restants`}
      </span>
    )
  if (isExpired) return <span className="text-xs text-red-400">Expiré</span>
  return <span className="text-xs text-muted-foreground">—</span>
}

function ActionButtons({ shop, isSuspended, loading, locale, onConfirm }: {
  shop: Shop; isSuspended: boolean; loading: string | null; locale: string
  onConfirm: (action: ActionType, shop: Shop) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={loading === shop.id}
          className="h-8 w-8 flex items-center justify-center rounded-lg border border-border bg-card hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem asChild>
          <Link href={`/${locale}/admin/shops/${shop.id}`} className="flex items-center gap-2 cursor-pointer">
            <Activity className="h-3.5 w-3.5 text-purple-400" />
            <span>Inspecter</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onConfirm('extend', shop)}
          disabled={!!loading}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Clock className="h-3.5 w-3.5 text-amber-400" />
          <span>Prolonger l'accès</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onConfirm('grant_plan', shop)}
          disabled={!!loading}
          className="flex items-center gap-2 cursor-pointer"
        >
          <CreditCard className="h-3.5 w-3.5 text-blue-400" />
          <span>Attribuer un plan</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isSuspended ? (
          <DropdownMenuItem
            onClick={() => onConfirm('reactivate', shop)}
            disabled={!!loading}
            className="flex items-center gap-2 cursor-pointer text-green-500 focus:text-green-500"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Réactiver</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => onConfirm('suspend', shop)}
            disabled={!!loading}
            className="flex items-center gap-2 cursor-pointer text-red-500 focus:text-red-500"
          >
            <ShieldOff className="h-3.5 w-3.5" />
            <span>Suspendre</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PaymentHistory({ shop }: { shop: Shop }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Historique des paiements</p>
      {shop.subscriptions.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun paiement enregistré.</p>
      ) : (
        shop.subscriptions.map((sub, i) => (
          <div key={i} className="flex items-center justify-between bg-card rounded-lg px-3 py-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`h-2 w-2 rounded-full flex-shrink-0 ${sub.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
              <span className="text-xs text-foreground capitalize">{sub.plan} plan</span>
              <span className="text-xs text-muted-foreground">
                {new Date(sub.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
              {sub.paystack_reference && (
                <span className="text-xs font-mono text-muted-foreground hidden sm:inline">{sub.paystack_reference}</span>
              )}
            </div>
            <span className="text-xs font-bold text-green-400 flex-shrink-0">{formatNaira(sub.amount)}</span>
          </div>
        ))
      )}
      {shop.whatsapp && (
        <a href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}?text=Hello from StockShop`}
          target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline mt-2">
          <ExternalLink className="h-3 w-3" /> WhatsApp owner
        </a>
      )}
      <ShopRestorePanel shopId={shop.id} shopName={shop.name} />
    </div>
  )
}

export function AdminShopsTable({ shops, locale }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'subscribed' | 'trial' | 'expired'>('all')
  const [country, setCountry] = useState<string>('all')

  // Derive unique countries from shops data
  const availableCountries = Array.from(new Set(shops.map(s => s.country || 'NG').filter(Boolean))).sort()
  const [loading, setLoading] = useState<string | null>(null)
  const [expandedShop, setExpandedShop] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; action: ActionType; shop: Shop | null; extra?: string
  }>({ open: false, action: 'suspend', shop: null })
  const [extendDays, setExtendDays] = useState('30')
  const [grantPlan, setGrantPlan] = useState('starter')

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState<{ open: boolean; action: ActionType } | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkExtendDays, setBulkExtendDays] = useState('30')
  const [bulkGrantPlan, setBulkGrantPlan] = useState('starter')

  const toggleSelect = (id: string) =>
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const toggleAll = () =>
    setSelected(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map(s => s.id)))

  const doBulkAction = async () => {
    if (!bulkConfirm) return
    setBulkLoading(true)
    setBulkConfirm(null)
    const ids = Array.from(selected)
    let success = 0
    let fail = 0
    await Promise.all(ids.map(async shopId => {
      try {
        const res = await fetch('/api/admin/shop-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: bulkConfirm.action,
            shop_id: shopId,
            days: bulkConfirm.action === 'extend' ? Number(bulkExtendDays)
              : bulkConfirm.action === 'grant_plan' ? bulkGrantPlan
              : undefined,
          }),
        })
        if (res.ok) success++; else fail++
      } catch { fail++ }
    }))
    setBulkLoading(false)
    setSelected(new Set())
    if (fail === 0) toast({ title: `✅ Action appliquée à ${success} boutique(s)`, variant: 'success' })
    else toast({ title: `${success} réussis, ${fail} échoués`, variant: 'destructive' })
    router.refresh()
  }

  const filtered = shops.filter(shop => {
    const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
    const trialDays = getTrialDaysLeft(shop.trial_ends_at)
    const isExpired = !subscribed && trialDays < 0

    if (search) {
      const q = search.toLowerCase()
      if (!shop.name.toLowerCase().includes(q) && !shop.city.toLowerCase().includes(q) &&
        !shop.owner?.full_name.toLowerCase().includes(q)) return false
    }
    if (filter === 'subscribed' && !subscribed) return false
    if (filter === 'trial' && (subscribed || trialDays < 0)) return false
    if (filter === 'expired' && !isExpired) return false
    if (country !== 'all' && (shop.country || 'NG') !== country) return false
    return true
  })

  const doAction = async () => {
    const { action, shop } = confirmDialog
    if (!shop) return
    setLoading(shop.id)
    setConfirmDialog(d => ({ ...d, open: false }))

    try {
      const res = await fetch('/api/admin/shop-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          shop_id: shop.id,
          days: action === 'extend' ? Number(extendDays) : action === 'grant_plan' ? grantPlan : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: data.message, variant: 'success' })
      router.refresh()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setLoading(null)
    }
  }

  const openConfirm = (action: ActionType, shop: Shop) => {
    setConfirmDialog({ open: true, action, shop })
  }

  return (
    <>
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {/* Table header + filters */}
        <div className="px-5 py-4 border-b border-border space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-foreground">Boutiques</h2>
              <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{filtered.length}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Nom, ville, propriétaire…"
                className="w-full bg-muted border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
            {/* Country filter */}
            <Select value={country} onValueChange={setCountry}>
              <SelectTrigger className="h-8 text-xs w-36 sm:w-40 bg-muted border-border flex-shrink-0">
                <SelectValue placeholder="Pays" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🌍 Tous les pays</SelectItem>
                {availableCountries.map(c => (
                  <SelectItem key={c} value={c}>{countryLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Plan status filter */}
            <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
              <SelectTrigger className="h-8 text-xs w-36 sm:w-44 bg-muted border-border flex-shrink-0">
                <SelectValue placeholder="Plan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les plans</SelectItem>
                <SelectItem value="subscribed">Payants</SelectItem>
                <SelectItem value="trial">En période d'essai</SelectItem>
                <SelectItem value="expired">Expirés</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mx-4 mb-2 flex items-center gap-2 flex-wrap bg-blue-950/40 border border-blue-500/30 rounded-xl px-4 py-2.5">
            <span className="text-sm font-semibold text-blue-300 mr-1">
              {selected.size} boutique{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}
            </span>
            {bulkLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
            <div className="flex flex-wrap gap-1.5 ml-auto">
              <button
                onClick={() => setBulkConfirm({ open: true, action: 'suspend' })}
                disabled={bulkLoading}
                className="h-7 px-3 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors border border-red-500/30"
              >
                Suspendre
              </button>
              <button
                onClick={() => setBulkConfirm({ open: true, action: 'reactivate' })}
                disabled={bulkLoading}
                className="h-7 px-3 rounded-lg text-xs font-medium bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors border border-green-500/30"
              >
                Réactiver
              </button>
              <button
                onClick={() => setBulkConfirm({ open: true, action: 'extend' })}
                disabled={bulkLoading}
                className="h-7 px-3 rounded-lg text-xs font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors border border-amber-500/30"
              >
                Prolonger
              </button>
              <button
                onClick={() => setBulkConfirm({ open: true, action: 'grant_plan' })}
                disabled={bulkLoading}
                className="h-7 px-3 rounded-lg text-xs font-medium bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-colors border border-violet-500/30"
              >
                Attribuer plan
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="h-7 px-2 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="pl-4 pr-1 py-3 w-8">
                  <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground transition-colors">
                    {selected.size === filtered.length && filtered.length > 0
                      ? <CheckSquare className="h-4 w-4 text-blue-400" />
                      : <Square className="h-4 w-4" />
                    }
                  </button>
                </th>
                {COLUMNS.map(col => (
                  <th key={col.key} className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-10 text-center text-muted-foreground text-sm">Aucune boutique trouvée</td>
                </tr>
              )}
              {filtered.map(shop => {
                const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
                const trialDays = getTrialDaysLeft(shop.trial_ends_at)
                const isExpired = !subscribed && trialDays < 0
                const isSuspended = shop.owner && !shop.owner.is_active
                const totalRevenue = shop.subscriptions.reduce((s, sub) => s + Number(sub.amount), 0)
                const isExpanded = expandedShop === shop.id
                const health = healthScore(shop.owner, subscribed)
                const healthColor = health >= 70 ? 'bg-green-400' : health >= 40 ? 'bg-amber-400' : 'bg-red-400'

                let daysRemaining: number | null = null
                if (subscribed && shop.plan_expires_at) {
                  daysRemaining = Math.ceil((new Date(shop.plan_expires_at).getTime() - Date.now()) / 86400000)
                } else if (!subscribed && trialDays >= 0) {
                  daysRemaining = trialDays
                }

                return (
                  <>
                    <tr
                      key={shop.id}
                      className={`border-b border-border/50 transition-colors ${isSuspended ? 'opacity-50' : 'hover:bg-muted/30'} ${selected.has(shop.id) ? 'bg-blue-950/20' : ''}`}
                    >
                      {/* Checkbox */}
                      <td className="pl-4 pr-1 py-3 w-8">
                        <button onClick={() => toggleSelect(shop.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                          {selected.has(shop.id)
                            ? <CheckSquare className="h-4 w-4 text-blue-400" />
                            : <Square className="h-4 w-4" />
                          }
                        </button>
                      </td>

                      {/* Shop + owner */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setExpandedShop(isExpanded ? null : shop.id)}>
                            {isExpanded
                              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                          </button>
                          <div>
                            <p className="font-medium text-foreground">{shop.name}</p>
                            <p className="text-xs text-muted-foreground">{shop.owner?.full_name || '—'}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <div className="h-1 w-10 bg-gray-700 rounded-full overflow-hidden">
                                <div className={`h-full ${healthColor} rounded-full`} style={{ width: `${health}%` }} />
                              </div>
                              <span className="text-[10px] text-muted-foreground">{health}</span>
                            </div>
                          </div>
                          {isSuspended && (
                            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">SUSPENDU</span>
                          )}
                        </div>
                      </td>

                      {/* Ville */}
                      <td className="px-5 py-3 text-muted-foreground text-xs">{shop.city}</td>

                      {/* Pays */}
                      <td className="px-5 py-3 text-xs text-foreground whitespace-nowrap">
                        {shop.country ? countryLabel(shop.country) : <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Plan */}
                      <td className="px-5 py-3">
                        <span className="text-foreground text-xs font-medium capitalize">{getPlan(shop.plan).name}</span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        <StatusBadge isSuspended={!!isSuspended} subscribed={subscribed} trialDays={trialDays} />
                      </td>

                      {/* Expiry */}
                      <td className="px-5 py-3">
                        <ExpiryCell daysRemaining={daysRemaining} isExpired={isExpired} />
                      </td>

                      {/* Revenue */}
                      <td className="px-5 py-3 text-foreground text-xs font-medium">
                        {totalRevenue > 0 ? formatNaira(totalRevenue) : <span className="text-muted-foreground">₦0</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <ActionButtons shop={shop} isSuspended={!!isSuspended} loading={loading} locale={locale} onConfirm={openConfirm} />
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {isExpanded && (
                      <tr key={`${shop.id}-expanded`} className="border-b border-border/50 bg-muted/20">
                        <td colSpan={COLUMNS.length + 1} className="px-8 py-4">
                          <PaymentHistory shop={shop} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-border/50">
          {filtered.length === 0 && (
            <p className="px-5 py-10 text-center text-muted-foreground text-sm">Aucune boutique trouvée</p>
          )}
          {filtered.map(shop => {
            const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
            const trialDays = getTrialDaysLeft(shop.trial_ends_at)
            const isExpired = !subscribed && trialDays < 0
            const isSuspended = shop.owner && !shop.owner.is_active
            const totalRevenue = shop.subscriptions.reduce((s, sub) => s + Number(sub.amount), 0)
            const isExpanded = expandedShop === shop.id
            const health = healthScore(shop.owner, subscribed)
            const healthColor = health >= 70 ? 'bg-green-400' : health >= 40 ? 'bg-amber-400' : 'bg-red-400'

            let daysRemaining: number | null = null
            if (subscribed && shop.plan_expires_at) {
              daysRemaining = Math.ceil((new Date(shop.plan_expires_at).getTime() - Date.now()) / 86400000)
            } else if (!subscribed && trialDays >= 0) {
              daysRemaining = trialDays
            }

            return (
              <div key={shop.id} className={`${isSuspended ? 'opacity-50' : ''} ${selected.has(shop.id) ? 'bg-blue-950/20' : ''}`}>
                <div className="px-4 py-3.5 space-y-2">
                  {/* Top row: name + status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <button onClick={() => toggleSelect(shop.id)} className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                        {selected.has(shop.id)
                          ? <CheckSquare className="h-4 w-4 text-blue-400" />
                          : <Square className="h-4 w-4" />
                        }
                      </button>
                      <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground text-sm">{shop.name}</p>
                        {isSuspended && (
                          <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">SUSPENDU</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{shop.owner?.full_name || '—'}</p>
                      </div>
                    </div>
                    <StatusBadge isSuspended={!!isSuspended} subscribed={subscribed} trialDays={trialDays} />
                  </div>

                  {/* Middle row: city, country, plan, expiry */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {shop.city && <span>{shop.city}</span>}
                    {shop.country && <span>{countryLabel(shop.country)}</span>}
                    <span className="text-foreground font-medium capitalize">{getPlan(shop.plan).name}</span>
                    <ExpiryCell daysRemaining={daysRemaining} isExpired={isExpired} />
                    {totalRevenue > 0 && <span className="text-green-400 font-medium">{formatNaira(totalRevenue)}</span>}
                  </div>

                  {/* Health bar */}
                  <div className="flex items-center gap-1.5">
                    <div className="h-1 w-16 bg-gray-700 rounded-full overflow-hidden">
                      <div className={`h-full ${healthColor} rounded-full`} style={{ width: `${health}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">Score {health}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <ActionButtons shop={shop} isSuspended={!!isSuspended} loading={loading} locale={locale} onConfirm={openConfirm} />
                  </div>

                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedShop(isExpanded ? null : shop.id)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isExpanded ? 'Masquer' : 'Historique paiements'}
                  </button>
                </div>

                {/* Expanded payment history */}
                {isExpanded && (
                  <div className="px-4 pb-4 bg-muted/20 space-y-2">
                    <PaymentHistory shop={shop} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Bulk confirm dialog */}
      <Dialog open={!!bulkConfirm?.open} onOpenChange={v => !v && setBulkConfirm(null)}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {bulkConfirm?.action === 'suspend' && '⚠️ Suspendre'}
              {bulkConfirm?.action === 'reactivate' && '✅ Réactiver'}
              {bulkConfirm?.action === 'extend' && '⏱️ Prolonger'}
              {bulkConfirm?.action === 'grant_plan' && '🎁 Attribuer un plan'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            Action sur <strong className="text-foreground">{selected.size} boutique{selected.size > 1 ? 's' : ''}</strong>.
          </p>
          {bulkConfirm?.action === 'extend' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Jours à ajouter</label>
              <input
                type="number" min={1} max={365}
                value={bulkExtendDays}
                onChange={e => setBulkExtendDays(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-stockshop-blue"
              />
            </div>
          )}
          {bulkConfirm?.action === 'grant_plan' && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Plan à attribuer</label>
              <select
                value={bulkGrantPlan}
                onChange={e => setBulkGrantPlan(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-stockshop-blue"
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="business">Business</option>
              </select>
            </div>
          )}
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setBulkConfirm(null)} className="border-border text-foreground hover:bg-accent">
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={doBulkAction}
              className={bulkConfirm?.action === 'suspend' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-stockshop-blue hover:bg-stockshop-blue-light text-white'}
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {confirmDialog.action === 'suspend' && '⚠️ Suspendre la boutique'}
              {confirmDialog.action === 'reactivate' && '✅ Réactiver la boutique'}
              {confirmDialog.action === 'extend' && '⏱️ Prolonger l\'accès'}
              {confirmDialog.action === 'grant_plan' && '🎁 Attribuer un plan'}
            </DialogTitle>
          </DialogHeader>

          <p className="text-muted-foreground text-sm">
            {confirmDialog.action === 'suspend' && (
              <><strong className="text-red-400">{confirmDialog.shop?.name}</strong> sera suspendue immédiatement. L'accès de tous les membres sera bloqué.</>
            )}
            {confirmDialog.action === 'reactivate' && (
              <><strong className="text-foreground">{confirmDialog.shop?.name}</strong> sera réactivée avec 30 jours d'essai.</>
            )}
            {confirmDialog.action === 'extend' && (
              <>Prolonger l'accès de <strong className="text-foreground">{confirmDialog.shop?.name}</strong>.</>
            )}
            {confirmDialog.action === 'grant_plan' && (
              <>Attribuer un plan payant à <strong className="text-foreground">{confirmDialog.shop?.name}</strong> pour 31 jours.</>
            )}
          </p>

          {confirmDialog.action === 'extend' && (
            <div className="mt-2">
              <label className="text-xs text-muted-foreground mb-1 block">Nombre de jours à ajouter</label>
              <input
                type="number"
                min={1}
                max={365}
                value={extendDays}
                onChange={e => setExtendDays(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-stockshop-blue"
              />
            </div>
          )}

          {confirmDialog.action === 'grant_plan' && (
            <div className="mt-2">
              <label className="text-xs text-muted-foreground mb-1 block">Plan à attribuer</label>
              <select
                value={grantPlan}
                onChange={e => setGrantPlan(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-stockshop-blue"
              >
                <option value="starter">Starter — ₦4,500/mois</option>
                <option value="pro">Pro — ₦9,500/mois</option>
                <option value="business">Business — ₦19,500/mois</option>
              </select>
            </div>
          )}

          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}
              className="border-border text-foreground hover:bg-accent">
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={doAction}
              className={
                confirmDialog.action === 'suspend'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : confirmDialog.action === 'reactivate'
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-stockshop-blue hover:bg-stockshop-blue-light text-white'
              }
            >
              Confirmer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
