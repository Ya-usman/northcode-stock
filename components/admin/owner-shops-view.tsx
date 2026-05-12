'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, Store, Trash2, AlertTriangle } from 'lucide-react'
import { hasActiveSubscription, getTrialDaysLeft } from '@/lib/saas/plans'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface Shop {
  id: string
  name: string
  city?: string
  country?: string
  currency?: string
  plan: string | null
  trial_ends_at: string | null
  plan_expires_at: string | null
  created_at: string
}

interface Owner {
  id: string
  full_name: string | null
  email?: string | null
  last_seen: string | null
  shops: Shop[]
}

interface Props {
  owners: Owner[]
  locale: string
}

function daysSince(date: string | null) {
  if (!date) return null
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
}

function ShopStatusBadge({ shop }: { shop: Shop }) {
  const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
  const trialDays = getTrialDaysLeft(shop.trial_ends_at)
  if (subscribed) return <span className="text-[10px] bg-green-400/10 text-green-400 rounded-full px-2 py-0.5 font-medium">Payant</span>
  if (trialDays >= 0) return <span className="text-[10px] bg-amber-400/10 text-amber-400 rounded-full px-2 py-0.5 font-medium">Trial {trialDays}j</span>
  return <span className="text-[10px] bg-red-400/10 text-red-400 rounded-full px-2 py-0.5 font-medium">Expiré</span>
}

export function OwnerShopsView({ owners: initialOwners, locale }: Props) {
  const { toast } = useToast()
  const [owners, setOwners] = useState(initialOwners)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filtered = owners.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      o.full_name?.toLowerCase().includes(q) ||
      o.email?.toLowerCase().includes(q) ||
      o.shops.some(s => s.name.toLowerCase().includes(q) || s.city?.toLowerCase().includes(q))
    )
  })

  const handleDelete = async (owner: Owner) => {
    setDeleting(owner.id)
    try {
      const res = await fetch(`/api/admin/owner/${owner.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur')
      toast({ title: `🗑️ Propriétaire « ${owner.full_name || owner.email} » supprimé définitivement`, variant: 'success' })
      setOwners(prev => prev.filter(o => o.id !== owner.id))
      setConfirmDeleteId(null)
      setConfirmText('')
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-foreground">Propriétaires</h2>
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{filtered.length}</span>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Nom, email, boutique…"
          className="bg-muted border border-border rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-52"
        />
      </div>

      {/* List */}
      <div className="divide-y divide-border/50">
        {filtered.length === 0 && (
          <p className="px-5 py-8 text-center text-muted-foreground text-sm">Aucun propriétaire trouvé</p>
        )}
        {filtered.map(owner => {
          const isOpen = expanded.has(owner.id)
          const lastSeenDays = daysSince(owner.last_seen)
          const totalPaid = owner.shops.filter(s => hasActiveSubscription(s.plan, s.plan_expires_at)).length
          const flag = owner.shops[0]?.country === 'CM' ? '🇨🇲' : owner.shops.length > 0 ? '🇳🇬' : ''
          const isConfirming = confirmDeleteId === owner.id
          const confirmLabel = owner.full_name || owner.email || owner.id
          const confirmValid = confirmText.trim().toLowerCase() === confirmLabel.trim().toLowerCase()

          return (
            <div key={owner.id}>
              {/* Owner row */}
              <div className="flex items-center gap-1 pr-3">
                <button
                  onClick={() => toggle(owner.id)}
                  className="flex-1 flex items-center gap-3 px-5 py-3.5 hover:bg-accent/30 transition-colors text-left min-w-0"
                >
                  <div className="flex-shrink-0">
                    {isOpen
                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    }
                  </div>

                  {/* Avatar */}
                  <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                    {owner.full_name?.[0]?.toUpperCase() || '?'}
                  </div>

                  {/* Name + email */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {owner.full_name || '—'} {flag}
                    </p>
                    {owner.email && (
                      <p className="text-xs text-muted-foreground truncate">{owner.email}</p>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-xs font-semibold text-foreground">{owner.shops.length} boutique{owner.shops.length !== 1 ? 's' : ''}</p>
                      <p className="text-[10px] text-muted-foreground">{totalPaid} payante{totalPaid !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right hidden md:block">
                      {lastSeenDays === null
                        ? <p className="text-[10px] text-muted-foreground">Jamais connecté</p>
                        : lastSeenDays === 0
                        ? <p className="text-[10px] text-green-400">Actif aujourd'hui</p>
                        : lastSeenDays <= 7
                        ? <p className="text-[10px] text-green-400">Actif il y a {lastSeenDays}j</p>
                        : lastSeenDays <= 30
                        ? <p className="text-[10px] text-amber-400">Vu il y a {lastSeenDays}j</p>
                        : <p className="text-[10px] text-red-400">Inactif {lastSeenDays}j</p>
                      }
                    </div>
                  </div>
                </button>

                {/* Delete owner button */}
                <button
                  onClick={() => {
                    setConfirmDeleteId(isConfirming ? null : owner.id)
                    setConfirmText('')
                  }}
                  className="p-2 rounded-lg hover:bg-red-950/30 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                  title="Supprimer ce propriétaire"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Confirmation suppression définitive */}
              {isConfirming && (
                <div className="mx-5 mb-3 p-3 rounded-lg bg-red-950/30 border border-red-800/40 space-y-2">
                  <p className="text-xs text-red-300 font-medium flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    Suppression définitive — le compte, toutes les boutiques et toutes leurs données seront effacés.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Tapez <span className="font-mono font-semibold text-foreground">{confirmLabel}</span> pour confirmer :
                  </p>
                  <input
                    autoFocus
                    value={confirmText}
                    onChange={e => setConfirmText(e.target.value)}
                    placeholder={confirmLabel}
                    className="w-full rounded-md bg-muted border border-border px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-red-500"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs px-3"
                      disabled={!confirmValid || deleting === owner.id}
                      onClick={() => handleDelete(owner)}
                    >
                      {deleting === owner.id ? 'Suppression…' : 'Supprimer définitivement'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-3"
                      onClick={() => { setConfirmDeleteId(null); setConfirmText('') }}
                    >
                      Annuler
                    </Button>
                  </div>
                </div>
              )}

              {/* Expanded shops */}
              {isOpen && (
                <div className="bg-muted/30 border-t border-border/50">
                  {owner.shops.length === 0 ? (
                    <p className="px-12 py-3 text-xs text-muted-foreground italic">Aucune boutique créée</p>
                  ) : owner.shops.map(shop => {
                    const shopFlag = shop.country === 'CM' ? '🇨🇲' : '🇳🇬'
                    return (
                      <Link
                        key={shop.id}
                        href={`/${locale}/admin/shops/${shop.id}`}
                        className="flex items-center gap-3 px-12 py-2.5 hover:bg-accent/40 transition-colors group"
                      >
                        <Store className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground group-hover:text-primary transition-colors font-medium">
                            {shop.name}
                          </span>
                          {shop.city && (
                            <span className="text-xs text-muted-foreground ml-2">{shopFlag} {shop.city}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <ShopStatusBadge shop={shop} />
                          <span className="text-xs text-muted-foreground">
                            {new Date(shop.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })}
                          </span>
                          <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">Inspecter →</span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
