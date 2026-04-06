'use client'

import { useState } from 'react'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  ShieldOff, ShieldCheck, Clock, CreditCard, Search,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react'

interface Shop {
  id: string
  name: string
  city: string
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
  const [loading, setLoading] = useState<string | null>(null)
  const [expandedShop, setExpandedShop] = useState<string | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean; action: ActionType; shop: Shop | null; extra?: string
  }>({ open: false, action: 'suspend', shop: null })
  const [extendDays, setExtendDays] = useState('7')
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
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {/* Table header + filters */}
        <div className="px-5 py-4 border-b border-gray-800 flex flex-wrap gap-3 items-center justify-between">
          <h2 className="font-semibold text-white">All Shops</h2>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search shop, owner…"
                className="bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-northcode-blue w-48"
              />
            </div>
            {/* Filter tabs */}
            {(['all', 'subscribed', 'trial', 'expired'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${
                  filter === f
                    ? 'bg-northcode-blue text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Shop / Owner</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">City</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Plan</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Status</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Expiry</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Revenue</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-500 text-sm">No shops found</td>
                </tr>
              )}
              {filtered.map(shop => {
                const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
                const trialDays = getTrialDaysLeft(shop.trial_ends_at)
                const isExpired = !subscribed && trialDays < 0
                const isSuspended = shop.owner && !shop.owner.is_active
                const totalRevenue = shop.subscriptions.reduce((s, sub) => s + Number(sub.amount), 0)
                const isExpanded = expandedShop === shop.id

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
                      className={`border-b border-gray-800/50 transition-colors ${
                        isSuspended ? 'opacity-50' : 'hover:bg-gray-800/30'
                      }`}
                    >
                      {/* Shop + owner */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setExpandedShop(isExpanded ? null : shop.id)}>
                            {isExpanded
                              ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
                              : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
                          </button>
                          <div>
                            <p className="font-medium text-white">{shop.name}</p>
                            <p className="text-xs text-gray-400">{shop.owner?.full_name || '—'}</p>
                          </div>
                          {isSuspended && (
                            <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">SUSPENDED</span>
                          )}
                        </div>
                      </td>

                      {/* City */}
                      <td className="px-5 py-3 text-gray-400 text-xs">{shop.city}</td>

                      {/* Plan */}
                      <td className="px-5 py-3">
                        <span className="text-gray-300 text-xs font-medium capitalize">
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
                            daysRemaining <= 7 ? 'text-amber-400' : 'text-gray-300'
                          }`}>
                            {daysRemaining === 0 ? 'Expires today' : `${daysRemaining}d left`}
                          </span>
                        ) : isExpired ? (
                          <span className="text-xs text-red-400">Expired</span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>

                      {/* Revenue */}
                      <td className="px-5 py-3 text-gray-300 text-xs font-medium">
                        {totalRevenue > 0 ? formatNaira(totalRevenue) : <span className="text-gray-600">₦0</span>}
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
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row — payment history */}
                    {isExpanded && (
                      <tr key={`${shop.id}-expanded`} className="border-b border-gray-800/50 bg-gray-800/20">
                        <td colSpan={7} className="px-8 py-4">
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Payment History</p>
                            {shop.subscriptions.length === 0 ? (
                              <p className="text-xs text-gray-600">No payments recorded yet.</p>
                            ) : (
                              shop.subscriptions.map((sub, i) => (
                                <div key={i} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-3">
                                    <span className={`h-2 w-2 rounded-full ${sub.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
                                    <span className="text-xs text-gray-300 capitalize">{sub.plan} plan</span>
                                    <span className="text-xs text-gray-500">
                                      {new Date(sub.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </span>
                                    {sub.paystack_reference && (
                                      <span className="text-xs font-mono text-gray-600">{sub.paystack_reference}</span>
                                    )}
                                  </div>
                                  <span className="text-xs font-bold text-green-400">{formatNaira(sub.amount)}</span>
                                </div>
                              ))
                            )}
                            {shop.whatsapp && (
                              <a
                                href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}?text=Hello from NorthCode`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline mt-2"
                              >
                                <ExternalLink className="h-3 w-3" /> WhatsApp owner
                              </a>
                            )}
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
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">
              {confirmDialog.action === 'suspend' && '⚠️ Suspend shop'}
              {confirmDialog.action === 'reactivate' && '✅ Reactivate shop'}
              {confirmDialog.action === 'extend' && '⏱️ Extend access'}
              {confirmDialog.action === 'grant_plan' && '🎁 Grant plan'}
            </DialogTitle>
          </DialogHeader>

          <p className="text-gray-400 text-sm">
            {confirmDialog.action === 'suspend' && (
              <>Suspend <strong className="text-white">{confirmDialog.shop?.name}</strong>? Their account will be locked immediately.</>
            )}
            {confirmDialog.action === 'reactivate' && (
              <>Reactivate <strong className="text-white">{confirmDialog.shop?.name}</strong>? They will get 7 days of trial access.</>
            )}
            {confirmDialog.action === 'extend' && (
              <>Extend access for <strong className="text-white">{confirmDialog.shop?.name}</strong>.</>
            )}
            {confirmDialog.action === 'grant_plan' && (
              <>Grant a paid plan to <strong className="text-white">{confirmDialog.shop?.name}</strong> for 31 days.</>
            )}
          </p>

          {confirmDialog.action === 'extend' && (
            <div className="mt-2">
              <label className="text-xs text-gray-400 mb-1 block">Number of days to add</label>
              <input
                type="number"
                min={1}
                max={365}
                value={extendDays}
                onChange={e => setExtendDays(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-northcode-blue"
              />
            </div>
          )}

          {confirmDialog.action === 'grant_plan' && (
            <div className="mt-2">
              <label className="text-xs text-gray-400 mb-1 block">Plan to grant</label>
              <select
                value={grantPlan}
                onChange={e => setGrantPlan(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-northcode-blue"
              >
                <option value="starter">Starter — ₦4,500/mo</option>
                <option value="pro">Pro — ₦9,500/mo</option>
                <option value="business">Business — ₦19,500/mo</option>
              </select>
            </div>
          )}

          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmDialog(d => ({ ...d, open: false }))}
              className="border-gray-700 text-gray-300 hover:bg-gray-800">
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
                  : 'bg-northcode-blue hover:bg-northcode-blue-light'
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
