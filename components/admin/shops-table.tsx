'use client'

import { useState } from 'react'
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
  ChevronDown, ChevronUp, ExternalLink, Activity,
} from 'lucide-react'
import { ShopRestorePanel } from '@/components/admin/shop-restore-panel'

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

export function AdminShopsTable({ shops, locale }: Props) {
  const { toast } = useToast()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'subscribed' | 'trial' | 'expired'>('all')
  const [country, setCountry] = useState<'all' | 'NG' | 'CM'>('all')
  const [loading, setLoading] = useState<string | null>(null)
  const [expandedShop, setExpandedShop] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; action: ActionType; shop: Shop | null; extra?: string
  }>({ open: false, action: 'suspend', shop: null })
  const [extendDays, setExtendDays] = useState('30')
  const [grantPlan, setGrantPlan] = useState('starter')

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
      // Reload page to reflect changes
      window.location.reload()
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
        <div className="px-5 py-4 border-b border-border flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-foreground">Boutiques</h2>
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{filtered.length}</span>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Nom, ville, propriétaire…"
                className="bg-muted border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-48"
              />
            </div>
            {/* Country filter */}
            {([
              { value: 'all', label: '🌍 Tous' },
              { value: 'NG', label: '🇳🇬 Nigeria' },
              { value: 'CM', label: '🇨🇲 Cameroun' },
            ] as const).map(c => (
              <button
                key={c.value}
                onClick={() => setCountry(c.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  country === c.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground/60 border border-border hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {c.label}
              </button>
            ))}
            {/* Plan status filter */}
            <div className="w-px h-5 bg-border" />
            {(['all', 'subscribed', 'trial', 'expired'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-accent text-accent-foreground border border-border'
                    : 'bg-muted text-foreground/60 border border-border hover:text-foreground hover:border-foreground/30'
                }`}
              >
                {f === 'all' ? 'Tous plans' : f === 'subscribed' ? 'Payants' : f === 'trial' ? 'Trials' : 'Expirés'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Shop / Owner</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">City</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Plan</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Status</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Expiry</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Revenue</th>
                <th className="text-left px-5 py-3 text-foreground/70 font-semibold text-xs uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-sm">No shops found</td>
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

                // Days remaining for active plan
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
                      className={`border-b border-border/50 transition-colors ${
                        isSuspended ? 'opacity-50' : 'hover:bg-muted/30'
                      }`}
                    >
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
                            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">SUSPENDED</span>
                          )}
                        </div>
                      </td>

                      {/* City */}
                      <td className="px-5 py-3 text-muted-foreground text-xs">{shop.city}</td>

                      {/* Plan */}
                      <td className="px-5 py-3">
                        <span className="text-foreground text-xs font-medium capitalize">
                          {getPlan(shop.plan).name}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">● Suspended</span>
                        ) : subscribed ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">● Subscribed</span>
                        ) : trialDays >= 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">● Trial</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">● Expired</span>
                        )}
                      </td>

                      {/* Expiry / Days remaining */}
                      <td className="px-5 py-3">
                        {daysRemaining !== null ? (
                          <span className={`text-xs font-medium ${
                            daysRemaining <= 3 ? 'text-red-400' :
                            daysRemaining <= 7 ? 'text-amber-400' : 'text-foreground'
                          }`}>
                            {daysRemaining === 0 ? 'Expires today' : `${daysRemaining}d left`}
                          </span>
                        ) : isExpired ? (
                          <span className="text-xs text-red-400">Expired</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>

                      {/* Revenue */}
                      <td className="px-5 py-3 text-foreground text-xs font-medium">
                        {totalRevenue > 0 ? formatNaira(totalRevenue) : <span className="text-muted-foreground">₦0</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          {isSuspended ? (
                            <button
                              onClick={() => openConfirm('reactivate', shop)}
                              disabled={!!loading}
                              className="flex items-center gap-1 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 px-2 py-1 rounded-md transition-colors"
                              title="Reactivate shop"
                            >
                              <ShieldCheck className="h-3 w-3" /> Reactivate
                            </button>
                          ) : (
                            <button
                              onClick={() => openConfirm('suspend', shop)}
                              disabled={!!loading}
                              className="flex items-center gap-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 px-2 py-1 rounded-md transition-colors"
                              title="Suspend shop"
                            >
                              <ShieldOff className="h-3 w-3" /> Suspend
                            </button>
                          )}
                          <button
                            onClick={() => openConfirm('extend', shop)}
                            disabled={!!loading}
                            className="flex items-center gap-1 text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 px-2 py-1 rounded-md transition-colors"
                            title="Extend trial/plan"
                          >
                            <Clock className="h-3 w-3" /> Extend
                          </button>
                          <button
                            onClick={() => openConfirm('grant_plan', shop)}
                            disabled={!!loading}
                            className="flex items-center gap-1 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 px-2 py-1 rounded-md transition-colors"
                            title="Grant plan"
                          >
                            <CreditCard className="h-3 w-3" /> Plan
                          </button>
                          <Link
                            href={`/${locale}/admin/shops/${shop.id}`}
                            className="flex items-center gap-1 text-xs bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 px-2 py-1 rounded-md transition-colors"
                            title="Inspecter la boutique"
                          >
                            <Activity className="h-3 w-3" /> Inspecter
                          </Link>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row — payment history */}
                    {isExpanded && (
                      <tr key={`${shop.id}-expanded`} className="border-b border-border/50 bg-muted/20">
                        <td colSpan={7} className="px-8 py-4">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Payment History</p>
                            {shop.subscriptions.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No payments recorded yet.</p>
                            ) : (
                              shop.subscriptions.map((sub, i) => (
                                <div key={i} className="flex items-center justify-between bg-card rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-3">
                                    <span className={`h-2 w-2 rounded-full ${sub.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
                                    <span className="text-xs text-foreground capitalize">{sub.plan} plan</span>
                                    <span className="text-xs text-muted-foreground">
                                      {new Date(sub.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </span>
                                    {sub.paystack_reference && (
                                      <span className="text-xs font-mono text-muted-foreground">{sub.paystack_reference}</span>
                                    )}
                                  </div>
                                  <span className="text-xs font-bold text-green-400">{formatNaira(sub.amount)}</span>
                                </div>
                              ))
                            )}
                            {shop.whatsapp && (
                              <a
                                href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}?text=Hello from StockShop`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline mt-2"
                              >
                                <ExternalLink className="h-3 w-3" /> WhatsApp owner
                              </a>
                            )}
                            <ShopRestorePanel shopId={shop.id} shopName={shop.name} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={open => setConfirmDialog(d => ({ ...d, open }))}>
        <DialogContent className="bg-card border-border text-foreground max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {confirmDialog.action === 'suspend' && '⚠️ Suspend shop'}
              {confirmDialog.action === 'reactivate' && '✅ Reactivate shop'}
              {confirmDialog.action === 'extend' && '⏱️ Extend access'}
              {confirmDialog.action === 'grant_plan' && '🎁 Grant plan'}
            </DialogTitle>
          </DialogHeader>

          <p className="text-muted-foreground text-sm">
            {confirmDialog.action === 'suspend' && (
              <>Suspend <strong className="text-foreground">{confirmDialog.shop?.name}</strong>? Their account will be locked immediately.</>
            )}
            {confirmDialog.action === 'reactivate' && (
              <>Reactivate <strong className="text-foreground">{confirmDialog.shop?.name}</strong>? They will get 30 days of trial access.</>
            )}
            {confirmDialog.action === 'extend' && (
              <>Extend access for <strong className="text-foreground">{confirmDialog.shop?.name}</strong>.</>
            )}
            {confirmDialog.action === 'grant_plan' && (
              <>Grant a paid plan to <strong className="text-foreground">{confirmDialog.shop?.name}</strong> for 31 days.</>
            )}
          </p>

          {confirmDialog.action === 'extend' && (
            <div className="mt-2">
              <label className="text-xs text-muted-foreground mb-1 block">Number of days to add</label>
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
              <label className="text-xs text-muted-foreground mb-1 block">Plan to grant</label>
              <select
                value={grantPlan}
                onChange={e => setGrantPlan(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-foreground text-sm focus:outline-none focus:border-stockshop-blue"
              >
                <option value="starter">Starter — ₦4,500/mo</option>
                <option value="pro">Pro — ₦9,500/mo</option>
                <option value="business">Business — ₦19,500/mo</option>
              </select>
            </div>
          )}

          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}
              className="border-border text-foreground hover:bg-accent">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={doAction}
              className={
                confirmDialog.action === 'suspend'
                  ? 'bg-red-600 hover:bg-red-700'
                  : confirmDialog.action === 'reactivate'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-stockshop-blue hover:bg-stockshop-blue-light'
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
