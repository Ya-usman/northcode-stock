'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Store, UserCheck, Trash2, Shield, Crown, Mail } from 'lucide-react'

const supabase = createClient()

interface Manager {
  id: string
  shop_id: string
  user_id: string
  role: 'owner' | 'manager'
  is_active: boolean
  email: string | null
  profiles: { full_name: string | null; id: string } | null
}

interface Shop {
  id: string
  name: string
  city?: string
  country?: string
}

interface Props {
  shops: Shop[]
  managers: Manager[]
}

export function ManagersView({ shops: initialShops, managers: initialManagers }: Props) {
  const { toast } = useToast()
  const [managers, setManagers] = useState(initialManagers)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ email: '', shop_id: '' })
  const [submitting, setSubmitting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const managersByShop: Record<string, Manager[]> = {}
  for (const m of managers) {
    if (!managersByShop[m.shop_id]) managersByShop[m.shop_id] = []
    managersByShop[m.shop_id].push(m)
  }

  const handleAssign = async () => {
    if (!form.email || !form.shop_id) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/assign-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, shop_id: form.shop_id, role: 'manager' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: 'Responsable assigné !', variant: 'success' })
      setAdding(false)
      setForm({ email: '', shop_id: '' })
      // Reload page to get fresh server-fetched data with emails
      window.location.reload()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (member: Manager) => {
    setRevoking(member.id)
    try {
      const { error } = await (supabase as any)
        .from('shop_members')
        .update({ is_active: false })
        .eq('id', member.id)
      if (error) throw new Error(error.message)
      toast({ title: 'Accès retiré', variant: 'success' })
      setManagers(prev => prev.filter(m => m.id !== member.id))
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Responsables de boutiques</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Les responsables assignés via l'onglet Équipe apparaissent ici automatiquement.
          </p>
        </div>
        <Button onClick={() => setAdding(true)} className="gap-2 bg-stockshop-blue hover:bg-stockshop-blue-light">
          <Plus className="h-4 w-4" /> Assigner un responsable
        </Button>
      </div>

      {/* Assign form */}
      {adding && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Assigner un responsable
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Email de l'utilisateur *</label>
              <input
                className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="email@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">L'utilisateur doit déjà avoir un compte.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Boutique *</label>
              <select
                className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.shop_id}
                onChange={e => setForm(f => ({ ...f, shop_id: e.target.value }))}
              >
                <option value="">Choisir une boutique</option>
                {initialShops.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAssign} loading={submitting} disabled={!form.email || !form.shop_id} className="bg-primary hover:bg-primary/90">
              Assigner
            </Button>
            <Button variant="outline" onClick={() => setAdding(false)}>Annuler</Button>
          </div>
        </div>
      )}

      {/* Shops list */}
      {initialShops.map(shop => {
        const shopManagers = managersByShop[shop.id] ?? []
        return (
          <div key={shop.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <Store className="h-4 w-4 text-primary flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{shop.name}</p>
                {shop.city && (
                  <p className="text-xs text-muted-foreground">
                    {shop.city} · {shop.country === 'CM' ? '🇨🇲 Cameroun' : '🇳🇬 Nigeria'}
                  </p>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {shopManagers.filter(m => m.role === 'manager').length} responsable{shopManagers.filter(m => m.role === 'manager').length !== 1 ? 's' : ''}
                {shopManagers.some(m => m.role === 'owner') && (
                  <span className="ml-1 text-stockshop-gold">· propriétaire</span>
                )}
              </span>
            </div>
            <div className="divide-y divide-border/50">
              {shopManagers.length === 0 ? (
                <p className="px-5 py-4 text-xs text-muted-foreground italic">Aucun responsable assigné</p>
              ) : shopManagers.map(m => (
                <div key={m.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {m.role === 'owner'
                      ? <Crown className="h-4 w-4 text-stockshop-gold flex-shrink-0" />
                      : <UserCheck className="h-4 w-4 text-violet-400 flex-shrink-0" />
                    }
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-foreground font-medium">{m.profiles?.full_name || m.email?.split('@')[0] || '—'}</p>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          m.role === 'owner'
                            ? 'bg-amber-400/10 text-amber-400'
                            : 'bg-violet-400/10 text-violet-400'
                        }`}>
                          {m.role === 'owner' ? 'Propriétaire' : 'Responsable'}
                        </span>
                      </div>
                      {m.email && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          {m.email}
                        </p>
                      )}
                    </div>
                  </div>
                  {m.role === 'manager' && (
                    <button
                      onClick={() => handleRevoke(m)}
                      disabled={revoking === m.id}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                      title="Retirer ce responsable"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
