'use client'

import { useState, useEffect } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { Plus, Store, Users, CheckCircle2, Trash2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import type { Shop } from '@/lib/types/database'

const supabase = createClient()

export default function ShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const { user, userShops, activeShop, switchShop, setDashboardShopFilter, profile, refreshShop } = useAuthContext()
  const { toast } = useToast()
  const t = useTranslations()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCity, setNewCity] = useState('')
  const [newCountry, setNewCountry] = useState<CountryCode>('NG')
  const [loading, setLoading] = useState(false)
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

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
        body: JSON.stringify({ name: newName.trim(), city: newCity.trim(), country: newCountry }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      const shop = json.shop

      await refreshShop()
      switchShop((shop as Shop).id)
      setDashboardShopFilter((shop as Shop).id)
      toast({ title: t('shops.created'), variant: 'success' })
      setCreating(false)
      setNewName('')
      setNewCity('')
      setNewCountry('NG')
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (shopId: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/shops/${shopId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || t('errors.generic'))
      toast({ title: 'Boutique supprimée', variant: 'success' })
      setConfirmDeleteId(null)
      if (activeShop?.id === shopId) {
        const next = userShops.find(s => s.id !== shopId)
        if (next) { switchShop(next.id); setDashboardShopFilter(next.id) }
      }
      await refreshShop()
    } catch (err: any) {
      toast({ title: err?.message ?? t('errors.generic'), variant: 'destructive' })
    } finally {
      setDeleting(false)
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
            <Button variant="stockshop" onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              {t('shops.new')}
            </Button>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <PremiumDialog
        open={creating}
        onOpenChange={open => { if (!open) { setCreating(false); setNewName(''); setNewCity(''); setNewCountry('NG') } }}
        category={t('nav.shops')}
        title={t('shops.new_form_title')}
        icon={<Store className="h-4 w-4" />}
      >
        <PremiumDialogBody className="space-y-3">
          <div className="space-y-1">
            <Label>{t('shops.name_label')}</Label>
            <Input
              placeholder={t('shops.name_placeholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>{t('shops.city_label')}</Label>
            <Input
              placeholder={t('shops.city_placeholder')}
              value={newCity}
              onChange={e => setNewCity(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <div className="space-y-1">
            <Label>Pays</Label>
            <select
              value={newCountry}
              onChange={e => setNewCountry(e.target.value as CountryCode)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              {Object.values(COUNTRIES).map(c => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.name} · {c.currencySymbol}
                </option>
              ))}
            </select>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={() => { setCreating(false); setNewName(''); setNewCity('') }}
          cancelLabel={t('actions.cancel')}
        >
          <Button
            onClick={handleCreate}
            loading={loading}
            disabled={!newName.trim() || loading}
            variant="stockshop"
            className="flex-1 h-11 rounded-xl font-semibold"
          >
            {t('shops.create')}
          </Button>
        </PremiumDialogFooter>
      </PremiumDialog>

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
                  isActive ? 'bg-stockshop-blue text-white' : 'bg-muted text-muted-foreground'
                )}>
                  {shop.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm truncate">{shop.name}</p>
                    {isActive && (
                      <Badge className="bg-stockshop-blue text-white text-[10px] px-1.5 py-0.5 flex items-center gap-1 flex-shrink-0">
                        <CheckCircle2 className="h-2.5 w-2.5" /> {t('shops.active')}
                      </Badge>
                    )}
                    <Badge variant={shop.plan === 'trial' ? 'warning' : 'success'} className="text-[10px] flex-shrink-0">
                      {shop.plan ?? 'trial'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    {shop.country && <span>{COUNTRIES[shop.country as CountryCode]?.flag ?? '🌐'}</span>}
                    {shop.city && <span className="truncate">{shop.city}</span>}
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Users className="h-3 w-3" />
                      {t('shops.members', { count: memberCounts[shop.id] ?? 0 })}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!isActive && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { switchShop(shop.id); setDashboardShopFilter(shop.id) }}
                      className="gap-1.5 text-xs"
                    >
                      {t('shops.switch')}
                    </Button>
                  )}
                  {isOwner && userShops.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(shop.id)}
                      className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-2"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Confirmation inline */}
              {confirmDeleteId === shop.id && (
                <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-900 flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-red-600 dark:text-red-400">Supprimer « {shop.name} » ?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tous les produits, ventes, clients et données de cette boutique seront définitivement effacés. Cette action est irréversible.
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        loading={deleting}
                        onClick={() => handleDelete(shop.id)}
                        className="text-xs h-7 px-3"
                      >
                        Oui, supprimer
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs h-7 px-3"
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                </div>
              )}
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
