'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Store, UserCheck, Trash2, Shield } from 'lucide-react'

const supabase = createClient()

export default function AdminManagersPage() {
  const { toast } = useToast()
  const [shops, setShops] = useState<any[]>([])
  const [managers, setManagers] = useState<any[]>([]) // shop_members with role=owner
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<string | null>(null) // shop_id being assigned
  const [form, setForm] = useState({ email: '', shop_id: '' })
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: s }, { data: m }, { data: u }] = await Promise.all([
      supabase.from('shops').select('id, name, city, country').order('name'),
      (supabase as any).from('shop_members')
        .select('id, shop_id, user_id, role, is_active, profiles(full_name, id), shops(name)')
        .in('role', ['owner'])
        .eq('is_active', true),
      supabase.from('profiles').select('id, full_name, role').order('full_name'),
    ])
    setShops(s ?? [])
    setManagers(m ?? [])
    setAllUsers(u ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleAssign = async () => {
    if (!form.email || !form.shop_id) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/assign-manager', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, shop_id: form.shop_id, role: 'owner' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast({ title: 'Responsable assigné !', variant: 'success' })
      setAdding(null)
      setForm({ email: '', shop_id: '' })
      load()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (memberId: string) => {
    if (!confirm('Retirer ce responsable ?')) return
    await (supabase as any).from('shop_members').update({ is_active: false }).eq('id', memberId)
    toast({ title: 'Accès retiré' })
    load()
  }

  // Group managers by shop
  const managersByShop: Record<string, any[]> = {}
  for (const m of managers) {
    if (!managersByShop[m.shop_id]) managersByShop[m.shop_id] = []
    managersByShop[m.shop_id].push(m)
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Responsables de boutiques</h1>
          <p className="text-gray-400 text-sm mt-1">Assigner des responsables qui gèrent leurs boutiques</p>
        </div>
        <Button onClick={() => setAdding('new')} className="gap-2 bg-northcode-blue hover:bg-northcode-blue-light">
          <Plus className="h-4 w-4" /> Assigner un responsable
        </Button>
      </div>

      {/* Assign form */}
      {adding && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-5 space-y-4">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Shield className="h-4 w-4 text-northcode-blue dark:text-blue-400" /> Assigner un responsable
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Email de l'utilisateur *</label>
              <input
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                placeholder="email@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">L'utilisateur doit déjà avoir un compte.</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Boutique *</label>
              <select
                className="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                value={form.shop_id}
                onChange={e => setForm(f => ({ ...f, shop_id: e.target.value }))}
              >
                <option value="">Choisir une boutique</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleAssign} loading={submitting} disabled={!form.email || !form.shop_id} className="bg-blue-600 dark:bg-blue-500">
              Assigner
            </Button>
            <Button variant="outline" onClick={() => setAdding(null)} className="border-gray-700 text-gray-300">Annuler</Button>
          </div>
        </div>
      )}

      {/* Shops list */}
      {loading ? (
        <p className="text-gray-500 text-sm">Chargement…</p>
      ) : shops.map(shop => {
        const shopManagers = managersByShop[shop.id] ?? []
        return (
          <div key={shop.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center gap-3">
              <Store className="h-4 w-4 text-northcode-blue dark:text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{shop.name}</p>
                {shop.city && <p className="text-xs text-gray-500">{shop.city} · {shop.country === 'CM' ? '🇨🇲 Cameroun' : '🇳🇬 Nigeria'}</p>}
              </div>
              <span className="text-xs text-gray-500">{shopManagers.length} responsable{shopManagers.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-gray-800/50">
              {shopManagers.length === 0 ? (
                <p className="px-5 py-3 text-xs text-gray-600 italic">Aucun responsable assigné</p>
              ) : shopManagers.map((m: any) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-green-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-white font-medium">{m.profiles?.full_name ?? '—'}</p>
                      <p className="text-xs text-gray-500 capitalize">{m.role}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(m.id)}
                    className="p-1.5 rounded-lg hover:bg-red-900/30 text-gray-600 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
