'use client'

import { useState, useEffect } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Store, Users, CheckCircle2, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { Shop } from '@/lib/types/database'

const supabase = createClient()

export default function ShopsPage({ params: { locale } }: { params: { locale: string } }) {
  const { user, userShops, activeShop, switchShop, profile, refreshShop } = useAuthContext()
  const { toast } = useToast()
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
      // Create shop
      const { data: shop, error } = await supabase.from('shops').insert({
        name: newName.trim(),
        city: newCity.trim() || null,
        owner_id: user.id,
        plan: 'trial',
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        currency: activeShop?.currency ?? 'NGN',
        country: activeShop?.country ?? 'NG',
      } as any).select().single()

      if (error || !shop) throw error ?? new Error('Erreur création boutique')

      // Add as owner in shop_members
      await supabase.from('shop_members').insert({
        shop_id: (shop as Shop).id,
        user_id: user.id,
        role: 'owner',
      } as any)

      await refreshShop()
      switchShop((shop as Shop).id)
      toast({ title: `Boutique "${newName}" créée !`, variant: 'success' })
      setCreating(false)
      setNewName('')
      setNewCity('')
    } catch (err: any) {
      toast({ title: err?.message ?? 'Erreur', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const isOwner = profile?.role === 'owner'

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">Mes boutiques</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{userShops.length} boutique{userShops.length !== 1 ? 's' : ''}</p>
          </div>
          {isOwner && (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouvelle boutique
            </Button>
          )}
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-3">
          <h2 className="font-semibold text-gray-900">Créer une nouvelle boutique</h2>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Nom de la boutique *</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
              placeholder="Ex: Ma Boutique Kano"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Ville</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
              placeholder="Ex: Lagos"
              value={newCity}
              onChange={e => setNewCity(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} loading={loading} disabled={!newName.trim()}>
              Créer
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Annuler
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
                'rounded-xl border-2 bg-white p-4 shadow-sm transition-all',
                isActive ? 'border-northcode-blue' : 'border-gray-100 hover:border-gray-200'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-lg font-bold text-sm flex-shrink-0',
                  isActive ? 'bg-northcode-blue text-white' : 'bg-gray-100 text-gray-600'
                )}>
                  {shop.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-sm truncate">{shop.name}</p>
                    {isActive && (
                      <Badge className="bg-northcode-blue text-white text-[10px] px-1.5 py-0.5 flex items-center gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Active
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    {shop.city && <span>{shop.city}</span>}
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {memberCounts[shop.id] ?? '–'} membre{(memberCounts[shop.id] ?? 0) !== 1 ? 's' : ''}
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
                    <ArrowLeftRight className="h-3 w-3" />
                    Activer
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {userShops.length === 0 && (
        <div className="rounded-xl border bg-white p-8 shadow-sm text-center">
          <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium text-gray-900">Aucune boutique</p>
          <p className="text-sm text-muted-foreground mt-1">Créez votre première boutique pour commencer.</p>
        </div>
      )}
    </div>
  )
}
