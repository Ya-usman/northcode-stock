'use client'

import { useState, useEffect } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Store, Users, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { Shop } from '@/lib/types/database'

const supabase = createClient()

export default function ShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const { user, userShops, activeShop, switchShop, profile, refreshShop } = useAuthContext()
  const { toast } = useToast()
  const t = useTranslations()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [loading, setLoading] = useState(false)
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    if (userShops.length === 0) return
    Promise.all(
      userShops.map(s =>
        supabase.from('shop_members').select('id', { count: 'exact', head: true })
          .eq('shop_id', s.id).eq('is_active', true)
          .then(({ count }) => [s.id, count ?? 0] as [string, number])
      )
    ).then(entries => setMemberCounts(Object.fromEntries(entries)))
  }, [userShops])

  const handleCreate = async () => {
    if (!newName.trim() || !user) return
    setLoading(true)
    try {
      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), city: newCity.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      const shop = json.shop

      await refreshShop()
      switchShop((shop as Shop).id)
      toast({ title: t('shops.created'), variant: 'success' })
      setCreating(false)
      setNewName('')
      setNewCity('')
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">{t('shops.title')}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t('shops.count', { count: userShops.length })}</p>
          </div>
          {isOwner && (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('shops.new')}
            </Button>
          )}
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-xl border bg-card p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-foreground">{t('shops.new_form_title')}</h2>
          <div>
            <label className="text-xs font-medium text-foreground/80 block mb-1">{t('shops.name_label')}</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('shops.name_placeholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground/80 block mb-1">{t('shops.city_label')}</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('shops.city_placeholder')}
              value={newCity}
              onChange={e => setNewCity(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} loading={loading} disabled={!newName.trim()}>
              {t('shops.create')}
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>
              {t('actions.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* Shop list */}
      <div className="space-y-3">
        {userShops.map(shop => {
          const isActive = shop.id === activeShop?.id
          return (
            <div
              key={shop.id}
              className={cn(
                'rounded-xl border-2 bg-card p-4 shadow-sm transition-all',
                isActive ? 'border-blue-500' : 'border-border hover:border-border'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg font-bold text-sm flex-shrink-0',
                  isActive ? 'bg-northcode-blue dark:bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
                )}>
                  {shop.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{shop.name}</p>
                    {isActive && (
                      <Badge className="bg-northcode-blue dark:bg-blue-500 text-white text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {t('shops.active')}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {shop.city && <span>{shop.city}</span>}
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {t('shops.members', { count: memberCounts[shop.id] ?? 0 })}
                    </span>
                    <Badge variant={shop.plan === 'trial' ? 'warning' : 'success'} className="text-[10px]">
                      {shop.plan ?? 'trial'}
                    </Badge>
                  </div>
                </div>
                {!isActive && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => switchShop(shop.id)}
                    className="gap-1.5 text-xs flex-shrink-0"
                  >
                    {t('shops.switch')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {userShops.length === 0 && (
        <div className="rounded-xl border bg-card p-8 shadow-sm text-center">
          <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-foreground">{t('shops.no_shops')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('shops.no_shops_detail')}</p>
        </div>
      )}
    </div>
  )
}
