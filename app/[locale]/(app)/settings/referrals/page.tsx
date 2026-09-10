'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ArrowLeft, Copy, Check, MessageCircle, Users, Wallet, Clock, Gift,
  CreditCard, Banknote, Info,
} from 'lucide-react'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from '@/lib/utils/currency'
import { withTimeout } from '@/lib/utils/with-timeout'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'

interface Summary {
  enabled: boolean
  code?: string | null
  code_active?: boolean
  wallet?: {
    currency: string
    available_balance: number
    pending_balance: number
    frozen: boolean
    auto_apply_to_subscription: boolean
  }
  totals?: { total_earned: number; total_used: number; total_withdrawn: number }
  referrals?: Array<{
    id: string
    shop_name: string
    status: string
    registered_at: string
    reward: { amount: number; currency: string; status: string; available_at: string | null } | null
  }>
  transactions?: Array<{
    id: string
    type: string
    amount: number
    currency: string
    status: string
    description: string | null
    created_at: string
  }>
  min_payout?: number | null
}

const STATUS_KEYS: Record<string, string> = {
  invited: 'status_invited',
  registered: 'status_registered',
  trial: 'status_trial',
  paid: 'status_paid',
  reward_pending: 'status_reward_pending',
  reward_available: 'status_reward_available',
  rejected: 'status_rejected',
  cancelled: 'status_cancelled',
}

const STATUS_COLORS: Record<string, string> = {
  invited: 'bg-muted text-muted-foreground',
  registered: 'bg-blue-500/10 text-blue-500',
  trial: 'bg-amber-500/10 text-amber-500',
  paid: 'bg-green-500/10 text-green-500',
  reward_pending: 'bg-amber-500/10 text-amber-500',
  reward_available: 'bg-green-500/10 text-green-500',
  rejected: 'bg-muted text-muted-foreground',
  cancelled: 'bg-red-500/10 text-red-500',
}

export default function ReferralsPage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('referrals')
  const { profile, user } = useAuth()
  const { toast } = useToast()

  // Même clé de cache local que le reste de l'app (caisse, stock,
  // dashboard...) : affiche instantanément les dernières données connues
  // au lieu du squelette, puis rafraîchit en arrière-plan — cette page
  // était la seule à ne pas encore suivre ce pattern.
  const cacheKey = `referrals_summary_${user?.id || 'anon'}`
  const [data, setData] = useState<Summary | null>(() => getPageCache<Summary>(cacheKey))
  const [loading, setLoading] = useState(() => !getPageCache<Summary>(cacheKey))
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [togglingAuto, setTogglingAuto] = useState(false)

  const load = useCallback(async () => {
    const cached = getPageCache<Summary>(cacheKey)
    if (cached) { setData(cached); setLoading(false) } else { setLoading(true) }
    try {
      const res = await withTimeout(fetch('/api/referrals/summary'))
      const json = await res.json()
      if (res.ok) { setData(json); setPageCache(cacheKey, json) }
    } catch {
      // silencieux — le cache déjà affiché (s'il existe) reste visible
    } finally {
      setLoading(false)
    }
  }, [cacheKey])

  useEffect(() => { load() }, [load])

  const referralLink = data?.code && typeof window !== 'undefined'
    ? `${window.location.origin}/ref/${data.code}`
    : ''

  const copy = async (text: string, which: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text)
      if (which === 'code') { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 1500) }
      else { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 1500) }
    } catch {
      toast({ title: t('copy_failed'), variant: 'destructive' })
    }
  }

  const shareWhatsApp = () => {
    const message = t('whatsapp_message', { link: referralLink })
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank')
  }

  const toggleAutoApply = async (checked: boolean) => {
    const previous = data?.wallet?.auto_apply_to_subscription ?? false

    // Optimiste : le switch bouge tout de suite, avant même la réponse
    // serveur — l'utilisateur ne doit jamais attendre un aller-retour
    // réseau pour voir un simple interrupteur réagir. On revient en
    // arrière seulement si la requête échoue.
    setData(prev => {
      if (!prev?.wallet) return prev
      const next = { ...prev, wallet: { ...prev.wallet, auto_apply_to_subscription: checked } }
      setPageCache(cacheKey, next)
      return next
    })
    setTogglingAuto(true)
    try {
      const res = await withTimeout(fetch('/api/referrals/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_apply_to_subscription: checked }),
      }))
      if (!res.ok) throw new Error()
    } catch {
      setData(prev => {
        if (!prev?.wallet) return prev
        const reverted = { ...prev, wallet: { ...prev.wallet, auto_apply_to_subscription: previous } }
        setPageCache(cacheKey, reverted)
        return reverted
      })
      toast({ title: t('update_failed'), variant: 'destructive' })
    } finally {
      setTogglingAuto(false)
    }
  }

  if (profile && profile.role !== 'owner') {
    return (
      <div className="max-w-2xl mx-auto p-4">
        <p className="text-sm text-muted-foreground">{t('not_owner')}</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4 pb-20">
      <Link href={`/${locale}/settings`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        {t('back_to_settings')}
      </Link>

      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Gift className="h-5 w-5 text-stockshop-blue" />
          {t('page_title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('page_subtitle')}</p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : !data?.enabled ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">{t('program_disabled')}</CardContent></Card>
      ) : (
        <>
          {/* 1. Solde disponible */}
          <Card className="bg-gradient-to-br from-stockshop-blue to-blue-700 border-0 text-white overflow-hidden">
            <CardContent className="p-5">
              <p className="text-xs font-medium text-blue-100 uppercase tracking-wide">{t('available_balance')}</p>
              <p className="text-3xl font-extrabold mt-1">{formatCurrency(data.wallet?.available_balance ?? 0, data.wallet?.currency || '₦')}</p>
              <div className="flex items-center gap-4 mt-3 text-xs text-blue-100">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {t('pending')}: {formatCurrency(data.wallet?.pending_balance ?? 0, data.wallet?.currency || '₦')}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* 2-3. Code + partage */}
          <Card>
            <CardContent className="p-5 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('your_code')}</p>
              <div className="flex items-center justify-between gap-3 bg-muted rounded-lg px-4 py-3">
                <span className="font-mono font-bold text-lg text-foreground tracking-wider">{data.code}</span>
                <button onClick={() => copy(data.code || '', 'code')} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title={t('copy_code')}>
                  {copiedCode ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={() => copy(referralLink, 'link')} className="gap-1.5 w-full">
                  {copiedLink ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {t('copy_link')}
                </Button>
                <Button size="sm" onClick={shareWhatsApp} className="gap-1.5 w-full bg-[#25D366] hover:bg-[#1ea952] text-white">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {t('share_whatsapp')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 4. Statistiques */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile icon={Wallet} label={t('total_earned')} value={formatCurrency(data.totals?.total_earned ?? 0, data.wallet?.currency || '₦')} />
            <StatTile icon={CreditCard} label={t('total_used')} value={formatCurrency(data.totals?.total_used ?? 0, data.wallet?.currency || '₦')} />
            <StatTile icon={Banknote} label={t('total_withdrawn')} value={formatCurrency(data.totals?.total_withdrawn ?? 0, data.wallet?.currency || '₦')} />
            <StatTile icon={Users} label={t('my_referrals')} value={String(data.referrals?.length ?? 0)} />
          </div>

          {/* Application automatique */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{t('auto_apply_label')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{t('auto_apply_desc')}</p>
              </div>
              <Switch
                checked={data.wallet?.auto_apply_to_subscription ?? false}
                onCheckedChange={toggleAutoApply}
                disabled={togglingAuto}
              />
            </CardContent>
          </Card>

          {/* 5. Mes filleuls */}
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('my_referrals')}</p>
              {(!data.referrals || data.referrals.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('no_referrals')}</p>
              ) : (
                <div className="space-y-2">
                  {data.referrals.map(r => (
                    <div key={r.id} className="flex items-center justify-between gap-3 bg-muted/50 rounded-lg px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{r.shop_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(r.registered_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || 'bg-muted text-muted-foreground'}`}>
                          {t(STATUS_KEYS[r.status] || 'status_registered')}
                        </span>
                        {r.reward && (
                          <span className="text-xs font-bold text-green-500">
                            +{formatCurrency(r.reward.amount, r.reward.currency)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 6. Historique */}
          <Card>
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('history')}</p>
              {(!data.transactions || data.transactions.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">{t('no_history')}</p>
              ) : (
                <div className="space-y-2">
                  {data.transactions.map(tx => {
                    const isCredit = Number(tx.amount) >= 0
                    return (
                      <div key={tx.id} className="flex items-center justify-between gap-3 py-2 border-b border-border/50 last:border-0">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{tx.description || t(`movement_${tx.type}`)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(tx.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                            {tx.status === 'pending' && <span className="ml-1.5 text-amber-500">· {t('pending')}</span>}
                          </p>
                        </div>
                        <span className={`text-sm font-bold flex-shrink-0 ${isCredit ? 'text-green-500' : 'text-foreground'}`}>
                          {isCredit ? '+' : ''}{formatCurrency(tx.amount, tx.currency)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {data.min_payout && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground px-1">
              <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              {t('min_payout_note', { amount: formatCurrency(data.min_payout, data.wallet?.currency || '₦') })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function StatTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3.5">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium">{label}</span>
        </div>
        <p className="text-base font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  )
}
