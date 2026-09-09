'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Badge } from '@/components/ui/badge'
import { Plus, ShieldCheck, Eye, Trash2 } from 'lucide-react'
import { withTimeout } from '@/lib/utils/with-timeout'

interface AdminEntry {
  id: string
  user_id: string
  email: string
  tier: 'super_admin' | 'support'
  added_by_name: string | null
  created_at: string
}

// Section "Administrateurs de la plateforme" de la page Équipe & accès —
// gère la table admin_users (migration 124) : qui peut entrer dans
// /admin, et à quel niveau. Réservé au niveau super_admin pour les
// mutations (ajouter/révoquer) ; les deux niveaux peuvent voir la liste.
export function AdminAccessPanel({ currentUserId, canManage }: { currentUserId: string; canManage: boolean }) {
  const { toast } = useToast()
  const [admins, setAdmins] = useState<AdminEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ email: string; tier: 'super_admin' | 'support' }>({ email: '', tier: 'support' })
  const [submitting, setSubmitting] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)

  const fetchAdmins = async () => {
    try {
      const res = await withTimeout(fetch('/api/admin/admins'))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAdmins(json.admins || [])
    } catch (err: any) {
      toast({ title: err.message || 'Erreur de chargement', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAdmins() }, [])

  const handleAdd = async () => {
    if (!form.email) return
    setSubmitting(true)
    try {
      const res = await withTimeout(fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: 'Administrateur ajouté', variant: 'success' })
      setAdding(false)
      setForm({ email: '', tier: 'support' })
      fetchAdmins()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (entry: AdminEntry) => {
    setRevoking(entry.id)
    try {
      const res = await withTimeout(fetch(`/api/admin/admins?id=${entry.id}`, { method: 'DELETE' }))
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: 'Accès révoqué', variant: 'success' })
      setAdmins(prev => prev.filter(a => a.id !== entry.id))
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="bg-card rounded-xl border shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" /> Administrateurs de la plateforme
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Qui peut accéder à /admin, et à quel niveau.</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setAdding(v => !v)} className="gap-1.5 h-9 text-sm">
            <Plus className="h-4 w-4" /> Ajouter
          </Button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Email *</label>
              <input
                className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                type="email"
                placeholder="email@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground mt-1">Le compte doit déjà exister.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Niveau *</label>
              <select
                className="w-full rounded-lg bg-input border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                value={form.tier}
                onChange={e => setForm(f => ({ ...f, tier: e.target.value as 'super_admin' | 'support' }))}
              >
                <option value="support">Support (lecture seule)</option>
                <option value="super_admin">Super admin (accès total)</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleAdd} loading={submitting} disabled={!form.email} className="h-9 text-sm">
              Ajouter
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)} className="h-9 text-sm">
              Annuler
            </Button>
          </div>
        </div>
      )}

      <div className="divide-y divide-border/50">
        {loading ? (
          <p className="text-xs text-muted-foreground py-3">Chargement…</p>
        ) : admins.length === 0 ? (
          <p className="text-xs text-muted-foreground py-3 italic">Aucun administrateur.</p>
        ) : admins.map(a => (
          <div key={a.id} className="py-2.5 flex items-center gap-3 min-w-0">
            {a.tier === 'super_admin'
              ? <ShieldCheck className="h-4 w-4 text-stockshop-gold flex-shrink-0" />
              : <Eye className="h-4 w-4 text-violet-400 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm text-foreground font-medium truncate max-w-[200px]">{a.email}</span>
                <Badge variant={a.tier === 'super_admin' ? 'default' : 'secondary'} className="text-[10px]">
                  {a.tier === 'super_admin' ? 'Super admin' : 'Support'}
                </Badge>
                {a.user_id === currentUserId && (
                  <span className="text-[10px] text-muted-foreground">(vous)</span>
                )}
              </div>
              {a.added_by_name && (
                <p className="text-[11px] text-muted-foreground mt-0.5">Ajouté par {a.added_by_name}</p>
              )}
            </div>
            {canManage && a.user_id !== currentUserId && (
              <button
                onClick={() => handleRevoke(a)}
                disabled={revoking === a.id}
                className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
                title="Révoquer l'accès admin"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
