'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, Copy, CheckCheck, TrendingUp, DollarSign, Edit2, ToggleLeft, ToggleRight, PlusCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Agent {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
  referral_code: string
  commission_rate: number
  is_active: boolean
  total_earned: number
  total_paid: number
  notes: string | null
  created_at: string
}

interface Commission {
  id: string
  agent_id: string
  shop_id: string
  subscription_amount: number
  commission_amount: number
  plan_id: string
  billing_period: string
  status: 'pending' | 'paid'
  created_at: string
  paid_at: string | null
  agent: { name: string; referral_code: string } | null
  shop: { name: string; city: string } | null
}

function AgentForm({ initial, onSave, onCancel }: {
  initial?: Partial<Agent>
  onSave: (data: any) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    email: initial?.email || '',
    phone: initial?.phone || '',
    city: initial?.city || '',
    referral_code: initial?.referral_code || '',
    commission_rate: initial?.commission_rate ?? 10,
    notes: initial?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({ ...form, id: initial?.id })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label>Nom complet *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="Alhaji Musa Ibrahim" />
        </div>
        <div className="space-y-1">
          <Label>Email</Label>
          <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} type="email" placeholder="agent@email.com" />
        </div>
        <div className="space-y-1">
          <Label>Téléphone</Label>
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+234 812 345 6789" />
        </div>
        <div className="space-y-1">
          <Label>Ville</Label>
          <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Kano" />
        </div>
        <div className="space-y-1">
          <Label>Code de parrainage * (unique)</Label>
          <Input
            value={form.referral_code}
            onChange={e => setForm(f => ({ ...f, referral_code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') }))}
            required
            placeholder="ALHAJI2025"
            maxLength={20}
            className="font-mono uppercase"
          />
        </div>
        <div className="space-y-1">
          <Label>Commission (%)</Label>
          <Input
            value={form.commission_rate}
            onChange={e => setForm(f => ({ ...f, commission_rate: Number(e.target.value) }))}
            type="number"
            min={0}
            max={50}
            step={0.5}
          />
        </div>
        <div className="col-span-2 space-y-1">
          <Label>Notes internes</Label>
          <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Zone couverte, contrat..." />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>Annuler</Button>
        <Button type="submit" loading={saving} className="bg-stockshop-blue">
          {initial?.id ? 'Mettre à jour' : 'Créer agent'}
        </Button>
      </div>
    </form>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copier"
    >
      {copied ? <CheckCheck className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [commissions, setCommissions] = useState<Commission[]>([])
  const [shops, setShops] = useState<{ id: string; name: string; city: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editAgent, setEditAgent] = useState<Agent | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid'>('all')
  const [markingIds, setMarkingIds] = useState<string[]>([])
  const [selectedCommissions, setSelectedCommissions] = useState<string[]>([])

  // Commission manuelle
  const [showCommissionForm, setShowCommissionForm] = useState(false)
  const [commissionForm, setCommissionForm] = useState({
    agent_id: '',
    shop_id: '',
    subscription_amount: '',
    commission_amount: '',
    plan_id: 'manual',
    billing_period: 'monthly',
    notes: '',
  })
  const [savingCommission, setSavingCommission] = useState(false)
  const [commissionError, setCommissionError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    const [agentsRes, commissionsRes, shopsRes] = await Promise.all([
      fetch('/api/admin/agents'),
      fetch('/api/admin/agents/commissions'),
      fetch('/api/admin/agents/shops'),
    ])
    const agentsData = await agentsRes.json()
    const commissionsData = await commissionsRes.json()
    const shopsData = shopsRes.ok ? await shopsRes.json() : { shops: [] }
    setAgents(agentsData.agents || [])
    setCommissions(commissionsData.commissions || [])
    setShops(shopsData.shops || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleSave = async (data: any) => {
    const method = data.id ? 'PATCH' : 'POST'
    const res = await fetch('/api/admin/agents', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Erreur serveur')
    }
    setShowForm(false)
    setEditAgent(null)
    await loadData()
  }

  const toggleActive = async (agent: Agent) => {
    await fetch('/api/admin/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: agent.id, is_active: !agent.is_active }),
    })
    await loadData()
  }

  const markPaid = async (ids: string[]) => {
    setMarkingIds(ids)
    await fetch('/api/admin/agents/commissions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    setMarkingIds([])
    setSelectedCommissions([])
    await loadData()
  }

  const handleCreateCommission = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingCommission(true)
    setCommissionError('')
    try {
      const res = await fetch('/api/admin/agents/commissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commissionForm,
          subscription_amount: Number(commissionForm.subscription_amount),
          commission_amount: Number(commissionForm.commission_amount),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setShowCommissionForm(false)
      setCommissionForm({ agent_id: '', shop_id: '', subscription_amount: '', commission_amount: '', plan_id: 'manual', billing_period: 'monthly', notes: '' })
      await loadData()
    } catch (err: any) {
      setCommissionError(err.message)
    } finally {
      setSavingCommission(false)
    }
  }

  const filteredCommissions = commissions.filter(c => {
    if (selectedAgentId && c.agent_id !== selectedAgentId) return false
    if (statusFilter === 'pending') return c.status === 'pending'
    if (statusFilter === 'paid') return c.status === 'paid'
    return true
  })

  const totalPending = commissions.filter(c => c.status === 'pending').reduce((acc, c) => acc + Number(c.commission_amount), 0)

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agents de terrain</h1>
          <p className="text-muted-foreground text-sm mt-1">Gérer les parrains et leurs commissions</p>
        </div>
        <Button onClick={() => { setShowForm(true); setEditAgent(null) }} className="bg-stockshop-blue">
          <Plus className="h-4 w-4 mr-1" /> Nouvel agent
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border p-4">
          <Users className="h-4 w-4 text-blue-400 mb-2" />
          <p className="text-2xl font-bold">{agents.filter(a => a.is_active).length}</p>
          <p className="text-xs text-muted-foreground">Agents actifs</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <TrendingUp className="h-4 w-4 text-green-400 mb-2" />
          <p className="text-2xl font-bold">{commissions.length}</p>
          <p className="text-xs text-muted-foreground">Commissions totales</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <DollarSign className="h-4 w-4 text-amber-400 mb-2" />
          <p className="text-2xl font-bold text-amber-400">
            {totalPending.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground">À payer (₦)</p>
        </div>
        <div className="bg-card rounded-xl border p-4">
          <DollarSign className="h-4 w-4 text-green-400 mb-2" />
          <p className="text-2xl font-bold text-green-400">
            {agents.reduce((acc, a) => acc + Number(a.total_paid), 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-muted-foreground">Déjà payé (₦)</p>
        </div>
      </div>

      {/* Formulaire création/édition */}
      {(showForm || editAgent) && (
        <div className="bg-card rounded-xl border p-5">
          <h2 className="font-semibold mb-4">{editAgent ? 'Modifier l\'agent' : 'Créer un agent'}</h2>
          <AgentForm
            initial={editAgent ?? undefined}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditAgent(null) }}
          />
        </div>
      )}

      {/* Liste des agents */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-2">
          <h2 className="font-semibold text-sm">Agents ({agents.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Chargement...</div>
        ) : agents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Aucun agent créé</div>
        ) : (
          <div className="divide-y">
            {agents.map(agent => (
              <div key={agent.id} className={`px-5 py-3 flex items-center gap-4 ${!agent.is_active ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{agent.name}</p>
                    <span
                      className="inline-flex items-center gap-0.5 font-mono text-xs bg-blue-500/10 text-blue-400 rounded px-1.5 py-0.5 cursor-pointer"
                      onClick={() => setSelectedAgentId(selectedAgentId === agent.id ? null : agent.id)}
                      title="Filtrer par cet agent"
                    >
                      {agent.referral_code}
                      <CopyButton text={agent.referral_code} />
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {[agent.city, agent.phone, agent.email].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold text-green-400">
                    {Number(agent.total_earned).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ₦
                  </p>
                  <p className="text-xs text-muted-foreground">{agent.commission_rate}% commission</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setEditAgent(agent); setShowForm(false) }}
                    className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
                    title="Modifier"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => toggleActive(agent)}
                    className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
                    title={agent.is_active ? 'Désactiver' : 'Activer'}
                  >
                    {agent.is_active
                      ? <ToggleRight className="h-4 w-4 text-green-400" />
                      : <ToggleLeft className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commission manuelle — formulaire */}
      {showCommissionForm && (
        <div className="bg-card rounded-xl border p-5 space-y-4">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <PlusCircle className="h-4 w-4 text-amber-400" />
            Créer une commission manuellement
          </h2>
          <form onSubmit={handleCreateCommission} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Agent *</Label>
                <select
                  required
                  value={commissionForm.agent_id}
                  onChange={e => {
                    const agent = agents.find(a => a.id === e.target.value)
                    const amount = Number(commissionForm.subscription_amount)
                    setCommissionForm(f => ({
                      ...f,
                      agent_id: e.target.value,
                      commission_amount: agent && amount ? String(Math.round(amount * agent.commission_rate / 100)) : f.commission_amount,
                    }))
                  }}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">— Sélectionner un agent —</option>
                  {agents.filter(a => a.is_active).map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.commission_rate}%)</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label>Boutique *</Label>
                <select
                  required
                  value={commissionForm.shop_id}
                  onChange={e => setCommissionForm(f => ({ ...f, shop_id: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">— Sélectionner une boutique —</option>
                  {shops.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label>Montant abonnement *</Label>
                <Input
                  required type="number" min={0}
                  value={commissionForm.subscription_amount}
                  onChange={e => {
                    const amount = Number(e.target.value)
                    const agent = agents.find(a => a.id === commissionForm.agent_id)
                    setCommissionForm(f => ({
                      ...f,
                      subscription_amount: e.target.value,
                      commission_amount: agent && amount ? String(Math.round(amount * agent.commission_rate / 100)) : f.commission_amount,
                    }))
                  }}
                  placeholder="ex: 9500"
                />
              </div>

              <div className="space-y-1">
                <Label>Commission (calculée auto)</Label>
                <Input
                  required type="number" min={0}
                  value={commissionForm.commission_amount}
                  onChange={e => setCommissionForm(f => ({ ...f, commission_amount: e.target.value }))}
                  placeholder="ex: 950"
                />
              </div>

              <div className="space-y-1">
                <Label>Plan</Label>
                <select
                  value={commissionForm.plan_id}
                  onChange={e => setCommissionForm(f => ({ ...f, plan_id: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="manual">Manuel</option>
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label>Période</Label>
                <select
                  value={commissionForm.billing_period}
                  onChange={e => setCommissionForm(f => ({ ...f, billing_period: e.target.value }))}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="monthly">Mensuel</option>
                  <option value="quarterly">Trimestriel</option>
                  <option value="annual">Annuel</option>
                  <option value="manual">Manuel</option>
                </select>
              </div>

              <div className="space-y-1 sm:col-span-2">
                <Label>Notes internes</Label>
                <Input
                  value={commissionForm.notes}
                  onChange={e => setCommissionForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Raison, contexte..."
                />
              </div>
            </div>

            {commissionError && <p className="text-sm text-destructive">{commissionError}</p>}

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowCommissionForm(false)}>
                Annuler
              </Button>
              <Button
                type="submit"
                disabled={savingCommission}
                className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
              >
                {savingCommission
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Création…</>
                  : <><PlusCircle className="h-3.5 w-3.5" />Créer la commission</>
                }
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Commissions */}
      <div className="bg-card rounded-xl border overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold text-sm">
            Commissions {selectedAgentId ? `— ${agents.find(a => a.id === selectedAgentId)?.name}` : ''}
          </h2>
          <div className="ml-auto flex items-center gap-2">
            {selectedAgentId && (
              <button onClick={() => setSelectedAgentId(null)} className="text-xs text-blue-400 hover:underline">
                Voir tout
              </button>
            )}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="text-xs border rounded-md px-2 py-1 bg-background"
            >
              <option value="all">Tous</option>
              <option value="pending">En attente</option>
              <option value="paid">Payées</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCommissionForm(v => !v)}
              className="h-7 text-xs gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
            >
              <PlusCircle className="h-3 w-3" />
              Commission manuelle
            </Button>
            {selectedCommissions.length > 0 && (
              <Button
                size="sm"
                onClick={() => markPaid(selectedCommissions)}
                loading={markingIds.length > 0}
                className="bg-green-600 hover:bg-green-700 text-white h-7 text-xs"
              >
                Marquer payées ({selectedCommissions.length})
              </Button>
            )}
          </div>
        </div>
        {filteredCommissions.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Aucune commission</div>
        ) : (
          <div className="divide-y">
            {filteredCommissions.map(c => (
              <div key={c.id} className="px-5 py-2.5 flex items-center gap-3">
                {c.status === 'pending' && (
                  <input
                    type="checkbox"
                    checked={selectedCommissions.includes(c.id)}
                    onChange={e => setSelectedCommissions(prev =>
                      e.target.checked ? [...prev, c.id] : prev.filter(id => id !== c.id)
                    )}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{c.shop?.name ?? c.shop_id}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.agent?.name} · {c.plan_id} {c.billing_period} · {new Date(c.created_at).toLocaleDateString('fr-FR')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-green-400">
                    +{Number(c.commission_amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ₦
                  </p>
                  <p className="text-xs text-muted-foreground">
                    sur {Number(c.subscription_amount).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  c.status === 'paid' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {c.status === 'paid' ? 'Payée' : 'En attente'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
