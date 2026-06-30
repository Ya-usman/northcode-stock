'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Store, UserCheck, Trash2, Shield, Crown, Mail, Search } from 'lucide-react'
import { COUNTRIES } from '@/lib/saas/countries'

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

function shopCountryLabel(country?: string) {
  if (!country) return null
  const cfg = COUNTRIES[country as keyof typeof COUNTRIES]
  return cfg ? `${cfg.flag} ${cfg.name}` : `🌐 ${country}`
}

export function ManagersView({ shops: initialShops, managers: initialManagers }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const [managers, setManagers] = useState(initialManagers)
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ email: '', shop_id: '' })
  const [submitting, setSubmitting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const managersByShop: Record<string, Manager[]> = {}
  for (const m of managers) {
    if (!managersByShop[m.shop_id]) managersByShop[m.shop_id] = []
    managersByShop[m.shop_id].push(m)
  }

  const filteredShops = search
    ? initialShops.filter(s => {
        const q = search.toLowerCase()
        return (
          s.name.toLowerCase().includes(q) ||
          s.city?.toLowerCase().includes(q) ||
          managersByShop[s.id]?.some(
            m => m.profiles?.full_name?.toLowerCase().includes(q) || m.email?.toLowerCase().includes(q)
          )
        )
      })
    : initialShops

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
      router.refresh()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (member: Manager) => {
    setRevoking(member.id)
    try {
      const res = await fetch('/api/admin/assign-manager', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: member.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: 'Accès retiré', variant: 'success' })
      setManagers(prev => prev.filter(m => m.id !== member.id))
      router.refresh()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight">Responsables</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            Assignés via l'onglet Équipe · apparaissent ici automatiquement.
          </p>
        </div>
        <Button
          onClick={() => setAdding(v => !v)}
          className="gap-2 bg-stockshop-blue hover:bg-stockshop-blue-light shrink-0 h-9 text-sm"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden xs:inline sm:inline">Assigner</span>
        </Button>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher boutique, responsable, email…"
          className="w-full bg-muted border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
        />
      </div>

      {/* ── Assign form ── */}
      {adding && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 sm:p-5 space-y-4">
          <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" /> Assigner un responsable
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Email *</label>
              <input
                className="w-full rounded-lg bg-input border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="email@example.com"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground mt-1">L'utilisateur doit déjà avoir un compte.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Boutique *</label>
              <select
                className="w-full rounded-lg bg-input border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.shop_id}
                onChange={e => setForm(f => ({ ...f, shop_id: e.target.value }))}
              >
                <option value="">Choisir une boutique</option>
                {initialShops.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.city ? ` — ${s.city}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleAssign}
              loading={submitting}
              disabled={!form.email || !form.shop_id}
              className="bg-primary hover:bg-primary/90 h-9 text-sm"
            >
              Assigner
            </Button>
            <Button variant="outline" onClick={() => setAdding(false)} className="h-9 text-sm">
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* ── Shops list ── */}
      {filteredShops.length === 0 && (
        <p className="text-center text-muted-foreground text-sm py-10">Aucune boutique trouvée</p>
      )}

      {filteredShops.map(shop => {
        const shopManagers = managersByShop[shop.id] ?? []
        const countryLabel = shopCountryLabel(shop.country)
        const managerCount = shopManagers.filter(m => m.role === 'manager').length
        const hasOwner = shopManagers.some(m => m.role === 'owner')

        return (
          <div key={shop.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">

            {/* Shop header */}
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Store className="h-4 w-4 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{shop.name}</p>
                    {(shop.city || countryLabel) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {[shop.city, countryLabel].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-xs text-muted-foreground">
                    {managerCount} responsable{managerCount !== 1 ? 's' : ''}
                  </span>
                  {hasOwner && (
                    <p className="text-[10px] text-stockshop-gold">+ propriétaire</p>
                  )}
                </div>
              </div>
            </div>

            {/* Members list */}
            <div className="divide-y divide-border/50">
              {shopManagers.length === 0 ? (
                <p className="px-4 py-4 text-xs text-muted-foreground italic">Aucun responsable assigné</p>
              ) : shopManagers.map(m => {
                const displayName = m.profiles?.full_name || m.email?.split('@')[0] || '—'
                const isOwner = m.role === 'owner'

                return (
                  <div key={m.id} className="px-4 py-3 flex items-center gap-3 min-w-0">
                    {/* Icon */}
                    {isOwner
                      ? <Crown className="h-4 w-4 text-stockshop-gold flex-shrink-0" />
                      : <UserCheck className="h-4 w-4 text-violet-400 flex-shrink-0" />
                    }

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-foreground font-medium truncate max-w-[160px] sm:max-w-none">
                          {displayName}
                        </span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                          isOwner
                            ? 'bg-amber-400/10 text-amber-400'
                            : 'bg-violet-400/10 text-violet-400'
                        }`}>
                          {isOwner ? 'Propriétaire' : 'Responsable'}
                        </span>
                      </div>
                      {m.email && (
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 min-w-0">
                          <Mail className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{m.email}</span>
                        </p>
                      )}
                    </div>

                    {/* Revoke button */}
                    {!isOwner && (
                      <button
                        onClick={() => handleRevoke(m)}
                        disabled={revoking === m.id}
                        className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                        title="Retirer ce responsable"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
