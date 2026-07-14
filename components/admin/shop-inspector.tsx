'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatNaira } from '@/lib/utils/currency'
import { getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { COUNTRIES, type CountryCode } from '@/lib/saas/countries'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { ShopRestorePanel } from '@/components/admin/shop-restore-panel'
import { withTimeout } from '@/lib/utils/with-timeout'
import {
  ArrowLeft, ShoppingBag, Users, Package, TrendingUp, Clock,
  MessageSquare, Send, Trash2, Phone, ExternalLink, Shield,
  ShieldOff, ShieldCheck, RefreshCw, AlertTriangle, CheckCircle2,
  Bell, StickyNote, Activity, CreditCard, ChevronRight, Pencil,
} from 'lucide-react'

interface Props {
  shopId: string
  locale: string
  adminEmail: string
}

export function ShopInspector({ shopId, locale, adminEmail }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [data, setData] = useState<any>(null)
  const [notes, setNotes] = useState<any[]>([])
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [notifType, setNotifType] = useState<'info' | 'warning' | 'urgent'>('info')
  const [notifTitle, setNotifTitle] = useState('')
  const [notifMsg, setNotifMsg] = useState('')
  const [sendingNotif, setSendingNotif] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'notes' | 'notifications' | 'restore' | 'edit'>('overview')
  const [editForm, setEditForm] = useState({ name: '', city: '', country: '', whatsapp: '', currency: '' })
  const [savingEdit, setSavingEdit] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [shopRes, notesRes, notifsRes] = await withTimeout(Promise.all([
        fetch(`/api/admin/shop/${shopId}`),
        fetch(`/api/admin/notes?shop_id=${shopId}`),
        fetch(`/api/admin/notify?shop_id=${shopId}`),
      ]))
      if (shopRes.ok) setData(await shopRes.json())
      if (notesRes.ok) setNotes(await notesRes.json())
      if (notifsRes.ok) setNotifications(await notifsRes.json())
    } catch (err: any) {
      toast({ title: err.message || 'Erreur de chargement', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [shopId])

  useEffect(() => {
    if (data?.shop) {
      setEditForm({
        name: data.shop.name || '',
        city: data.shop.city || '',
        country: data.shop.country || '',
        whatsapp: data.shop.whatsapp || '',
        currency: data.shop.currency || '',
      })
    }
  }, [data])

  const saveEdit = async () => {
    setSavingEdit(true)
    try {
      const res = await withTimeout(fetch('/api/admin/shop-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_shop',
          shop_id: shopId,
          name: editForm.name || undefined,
          city: editForm.city || undefined,
          country: editForm.country || undefined,
          whatsapp: editForm.whatsapp !== '' ? editForm.whatsapp : undefined,
          currency: editForm.currency || undefined,
        }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error, variant: 'destructive' }); return }
      toast({ title: '✅ Boutique mise à jour', variant: 'success' })
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setSavingEdit(false)
    }
  }

  const shopAction = async (action: string, extra?: Record<string, any>) => {
    setActionLoading(true)
    try {
      const res = await withTimeout(fetch('/api/admin/shop-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, action, ...extra }),
      }))
      const json = await res.json()
      if (!res.ok) { toast({ title: json.error, variant: 'destructive' }); return }
      toast({ title: '✅ Action effectuée', variant: 'success' })
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setActionLoading(false)
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) return
    setSavingNote(true)
    try {
      const res = await withTimeout(fetch('/api/admin/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, content: noteText }),
      }))
      if (!res.ok) { toast({ title: 'Erreur', variant: 'destructive' }); return }
      setNoteText('')
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setSavingNote(false)
    }
  }

  const deleteNote = async (id: string) => {
    try {
      await withTimeout(fetch(`/api/admin/notes?id=${id}`, { method: 'DELETE' }))
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    }
  }

  const sendNotification = async () => {
    if (!notifTitle.trim() || !notifMsg.trim()) return
    setSendingNotif(true)
    try {
      const res = await withTimeout(fetch('/api/admin/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop_id: shopId, type: notifType, title: notifTitle, message: notifMsg }),
      }))
      if (!res.ok) { toast({ title: 'Erreur', variant: 'destructive' }); return }
      toast({ title: '✅ Notification envoyée', variant: 'success' })
      setNotifTitle(''); setNotifMsg(''); load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    } finally {
      setSendingNotif(false)
    }
  }

  const deleteNotif = async (id: string) => {
    try {
      await withTimeout(fetch(`/api/admin/notify?id=${id}`, { method: 'DELETE' }))
      load()
    } catch (err: any) {
      toast({ title: err.message || 'Erreur', variant: 'destructive' })
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!data?.shop) {
    return (
      <div className="text-center py-24">
        <p className="text-muted-foreground">Boutique introuvable.</p>
        <Link href={`/${locale}/admin/shops`} className="text-blue-400 hover:underline text-sm mt-2 inline-block">← Retour</Link>
      </div>
    )
  }

  const { shop, owner, members, stats, subscriptions, health, daysSinceLastSeen } = data
  const trialDays = getTrialDaysLeft(shop.trial_ends_at)
  const isPaid = hasActiveSubscription(shop.plan, shop.plan_expires_at)
  const isExpired = !isPaid && trialDays < 0
  const isSuspended = shop.is_active === false

  const healthColor = health >= 70 ? 'text-green-400' : health >= 40 ? 'text-amber-400' : 'text-red-400'
  const healthBg = health >= 70 ? 'bg-green-400' : health >= 40 ? 'bg-amber-400' : 'bg-red-400'

  const statusBadge = isSuspended
    ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400 font-medium">SUSPENDU</span>
    : isPaid
      ? <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400 font-medium">PAYANT</span>
      : isExpired
        ? <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400 font-medium">EXPIRÉ</span>
        : <span className="px-2 py-0.5 rounded text-xs bg-amber-500/20 text-amber-400 font-medium">TRIAL {trialDays}j</span>

  const tabs = [
    { id: 'overview', label: 'Vue générale', icon: Activity },
    { id: 'notes', label: `Notes (${notes.length})`, icon: StickyNote },
    { id: 'notifications', label: `Notifications (${notifications.length})`, icon: Bell },
    { id: 'restore', label: 'Restauration', icon: RefreshCw },
    { id: 'edit', label: 'Modifier', icon: Pencil },
  ] as const

  return (
    <div className="max-w-5xl space-y-5">
      {/* Back */}
      <Link href={`/${locale}/admin/shops`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        Toutes les boutiques
      </Link>

      {/* Header identité */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center shrink-0">
              <ShoppingBag className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-foreground">{shop.name}</h1>
                {statusBadge}
              </div>
              <p className="text-muted-foreground text-sm mt-0.5">{shop.city || '—'}</p>
              <p className="text-muted-foreground text-xs mt-1">
                Inscrit le {new Date(shop.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Owner info */}
          <div className="text-right">
            <p className="text-foreground text-sm font-medium">{owner?.full_name || 'Inconnu'}</p>
            <p className="text-muted-foreground text-xs">{owner?.email || '—'}</p>
            {shop.whatsapp && (
              <a
                href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}?text=Bonjour depuis StockShop Support`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-green-400 hover:underline mt-1"
              >
                <Phone className="h-3 w-3" /> WhatsApp
              </a>
            )}
          </div>
        </div>

        {/* Score de santé */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Score de santé</span>
            <span className={`text-sm font-bold ${healthColor}`}>{health}/100</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${healthBg} rounded-full transition-all`} style={{ width: `${health}%` }} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span className={daysSinceLastSeen !== null && daysSinceLastSeen <= 7 ? 'text-green-400' : ''}>
              {daysSinceLastSeen === null ? '• Jamais connecté' : daysSinceLastSeen === 0 ? '• Connecté aujourd\'hui' : `• Dernière connexion il y a ${daysSinceLastSeen}j`}
            </span>
            <span className={stats.sales7d > 0 ? 'text-green-400' : ''}>• {stats.sales7d} vente(s) cette semaine</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as any)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === id
                ? 'border-blue-500 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab: Vue générale */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Produits actifs', value: stats.productsActive, icon: Package, color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { label: 'Clients actifs', value: stats.customersActive, icon: Users, color: 'text-purple-400', bg: 'bg-purple-400/10' },
              { label: 'Total ventes', value: stats.totalSales, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-400/10' },
              { label: 'CA total', value: formatNaira(stats.totalSalesAmount), icon: CreditCard, color: 'text-amber-400', bg: 'bg-amber-400/10' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className="bg-card rounded-xl border border-border shadow-sm p-4">
                <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${bg} mb-2`}>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <p className="text-lg font-bold text-foreground">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Secondaire stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
              <p className="text-2xl font-extrabold text-foreground">{stats.salesToday}</p>
              <p className="text-xs text-muted-foreground mt-1">Ventes aujourd'hui</p>
              <p className="text-xs text-green-400 mt-0.5">{formatNaira(stats.salesTodayAmount)}</p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
              <p className="text-2xl font-extrabold text-amber-400">{stats.productsArchived}</p>
              <p className="text-xs text-muted-foreground mt-1">Produits archivés</p>
            </div>
            <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
              <p className="text-2xl font-extrabold text-red-400">{stats.deletedLogCount}</p>
              <p className="text-xs text-muted-foreground mt-1">Dans la corbeille</p>
            </div>
          </div>

          {/* Plan */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              Abonnement
            </h3>
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <p className="text-xs text-muted-foreground">Plan actuel</p>
                <p className="text-foreground font-medium capitalize">{shop.plan || 'Aucun'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Trial expire</p>
                <p className="text-foreground font-medium">
                  {shop.trial_ends_at ? new Date(shop.trial_ends_at).toLocaleDateString('fr-FR') : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Plan expire</p>
                <p className="text-foreground font-medium">
                  {shop.plan_expires_at ? new Date(shop.plan_expires_at).toLocaleDateString('fr-FR') : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Paiements</p>
                <p className="text-foreground font-medium">{subscriptions.length}</p>
              </div>
            </div>

            {subscriptions.length > 0 && (
              <div className="mt-4 space-y-2">
                {subscriptions.slice(0, 5).map((sub: any, i: number) => (
                  <div key={i} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${sub.status === 'active' ? 'bg-green-400' : 'bg-gray-500'}`} />
                      <span className="text-xs text-foreground capitalize">{sub.plan}</span>
                      <span className="text-xs text-muted-foreground">{new Date(sub.created_at).toLocaleDateString('fr-FR')}</span>
                      {sub.paystack_reference && <span className="text-xs font-mono text-muted-foreground">{sub.paystack_reference}</span>}
                    </div>
                    <span className="text-xs font-bold text-green-400">{formatNaira(sub.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Membres de l'équipe */}
          {members.length > 0 && (
            <div className="bg-card rounded-xl border border-border shadow-sm p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Équipe ({members.filter((m: any) => m.is_active).length} actif(s))
              </h3>
              <div className="space-y-2">
                {members.map((m: any) => (
                  <div key={m.user_id} className="flex items-center justify-between bg-muted rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${m.is_active ? 'bg-green-400' : 'bg-gray-600'}`} />
                      <span className="text-sm text-foreground">{m.profiles?.full_name || 'Inconnu'}</span>
                      <span className="text-xs text-muted-foreground capitalize">{m.role}</span>
                    </div>
                    {m.profiles?.last_seen && (
                      <span className="text-xs text-muted-foreground">
                        Vu {new Date(m.profiles.last_seen).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions rapides */}
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Actions Support
            </h3>
            <div className="flex flex-wrap gap-2">
              {!isSuspended ? (
                <Button
                  size="sm" variant="outline"
                  className="border-red-700 text-red-400 hover:bg-red-900/30"
                  disabled={actionLoading}
                  onClick={() => shopAction('suspend')}
                >
                  <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                  Suspendre
                </Button>
              ) : (
                <Button
                  size="sm" variant="outline"
                  className="border-green-700 text-green-400 hover:bg-green-900/30"
                  disabled={actionLoading}
                  onClick={() => shopAction('reactivate')}
                >
                  <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                  Réactiver
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className="border-blue-700 text-blue-400 hover:bg-blue-900/30"
                disabled={actionLoading}
                onClick={() => shopAction('extend', { days: 30 })}
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                +30 jours trial
              </Button>
              <Button
                size="sm" variant="outline"
                className="border-amber-700 text-amber-400 hover:bg-amber-900/30"
                disabled={actionLoading}
                onClick={() => shopAction('extend', { days: 7 })}
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                +7 jours
              </Button>
              <Button
                size="sm" variant="outline"
                className="border-purple-700 text-purple-400 hover:bg-purple-900/30"
                disabled={actionLoading}
                onClick={() => shopAction('grant_plan', { plan: 'starter' })}
              >
                <CreditCard className="h-3.5 w-3.5 mr-1.5" />
                Activer Starter
              </Button>
              {shop.whatsapp && (
                <a
                  href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}?text=Bonjour depuis StockShop Support`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button size="sm" variant="outline" className="border-green-700 text-green-400 hover:bg-green-900/30">
                    <Phone className="h-3.5 w-3.5 mr-1.5" />
                    WhatsApp
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Notes internes */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-amber-400" />
              Ajouter une note interne
            </h3>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Ex : Client a appelé le 10 mai pour perte de données. Restauré via admin. À surveiller."
              className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
              rows={4}
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-muted-foreground">{adminEmail}</span>
              <Button size="sm" disabled={savingNote || !noteText.trim()} onClick={saveNote}>
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {savingNote ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {notes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">Aucune note pour cette boutique.</p>
            )}
            {notes.map((note: any) => (
              <div key={note.id} className="bg-card rounded-xl border border-border shadow-sm p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {note.author_email} · {new Date(note.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                  </div>
                  <button onClick={() => deleteNote(note.id)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Notifications in-app */}
      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <div className="bg-card rounded-xl border border-border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4 text-blue-400" />
              Envoyer un message au owner
            </h3>
            <div className="space-y-3">
              <div className="flex gap-2">
                {(['info', 'warning', 'urgent'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setNotifType(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      notifType === t
                        ? t === 'urgent' ? 'bg-red-500/20 border-red-500 text-red-400'
                          : t === 'warning' ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                          : 'bg-blue-500/20 border-blue-500 text-blue-400'
                        : 'border-border text-muted-foreground hover:border-gray-500'
                    }`}
                  >
                    {t === 'info' ? 'Info' : t === 'warning' ? 'Avertissement' : 'Urgent'}
                  </button>
                ))}
              </div>
              <input
                value={notifTitle}
                onChange={e => setNotifTitle(e.target.value)}
                placeholder="Titre du message"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <textarea
                value={notifMsg}
                onChange={e => setNotifMsg(e.target.value)}
                placeholder="Contenu du message visible par le owner dans son dashboard…"
                className="w-full bg-muted border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                rows={3}
              />
              <div className="flex justify-end">
                <Button size="sm" disabled={sendingNotif || !notifTitle.trim() || !notifMsg.trim()} onClick={sendNotification}>
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  {sendingNotif ? 'Envoi…' : 'Envoyer'}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Historique des notifications</p>
            {notifications.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">Aucune notification envoyée.</p>
            )}
            {notifications.map((n: any) => (
              <div key={n.id} className={`bg-card rounded-xl border p-4 flex items-start justify-between gap-3 ${
                n.type === 'urgent' ? 'border-red-800/50' : n.type === 'warning' ? 'border-amber-800/50' : 'border-border'
              }`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-medium ${
                      n.type === 'urgent' ? 'text-red-400' : n.type === 'warning' ? 'text-amber-400' : 'text-blue-400'
                    }`}>
                      {n.type === 'urgent' ? '🔴 URGENT' : n.type === 'warning' ? '🟡 AVERTISSEMENT' : '🔵 INFO'}
                    </span>
                    <span className="text-xs text-muted-foreground">{new Date(n.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    {n.read_at
                      ? <span className="text-xs text-green-500">Lu ✓</span>
                      : <span className="text-xs text-muted-foreground">Non lu</span>}
                  </div>
                  <p className="text-sm font-medium text-foreground">{n.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                </div>
                <button onClick={() => deleteNotif(n.id)} className="text-muted-foreground hover:text-red-400 transition-colors shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Restauration */}
      {activeTab === 'restore' && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-amber-400" />
            Restauration des données
          </h3>
          <p className="text-xs text-muted-foreground mb-4">Restaurez les produits supprimés, archivés, et les clients supprimés pour cette boutique.</p>
          <ShopRestorePanel shopId={shopId} shopName={shop.name} />
        </div>
      )}

      {/* Tab: Modifier */}
      {activeTab === 'edit' && (
        <div className="bg-card rounded-xl border border-border shadow-sm p-5 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Pencil className="h-4 w-4 text-blue-400" />
              Modifier les informations de la boutique
            </h3>
            <p className="text-xs text-muted-foreground mt-1">Les modifications sont appliquées immédiatement.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Nom de la boutique</label>
              <input
                value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                placeholder="Nom de la boutique"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Ville</label>
              <input
                value={editForm.city}
                onChange={e => setEditForm(f => ({ ...f, city: e.target.value }))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                placeholder="Lagos, Douala…"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Pays</label>
              <select
                value={editForm.country}
                onChange={e => {
                  const code = e.target.value as CountryCode
                  const auto = COUNTRIES[code]?.currencySymbol || ''
                  setEditForm(f => ({ ...f, country: code, currency: auto }))
                }}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
              >
                {Object.values(COUNTRIES).map(c => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">WhatsApp (format international)</label>
              <input
                value={editForm.whatsapp}
                onChange={e => setEditForm(f => ({ ...f, whatsapp: e.target.value }))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                placeholder="+2348012345678"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Devise</label>
              <input
                value={editForm.currency}
                onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500"
                placeholder="₦, FCFA…"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              disabled={savingEdit}
              onClick={saveEdit}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {savingEdit ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
