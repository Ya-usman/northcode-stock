'use client'

// Admin → Devis sur mesure (tarification du 4 nov. 2026, étape 3 ; migration 211). Lecture : tout administrateur ;
// envoyer, prolonger, refuser : super_admin (le serveur le revérifie). Console interne en français.
//   Liste des demandes (état calculé) → fiche : demande, utilisation actuelle, pays de tarification, prix conseillé
//   (Business + boutiques et employés au-delà, prix des options du pays) ; prix final, durée, limites, message ;
//   « Envoyer le devis » : e-mail au propriétaire avec le PDF et le lien de paiement, texte WhatsApp à copier.

import { useCallback, useEffect, useState } from 'react'
import { Copy, FileText, RefreshCw, Send, XCircle, CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { AppDrawer } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { formatCurrency } from '@/lib/utils/currency'
import { quoteTotal } from '@/lib/saas/custom-plan'
import { cn } from '@/lib/utils/cn'

type State = 'requested' | 'quoted' | 'paid' | 'declined' | 'expired' | 'cancelled'
interface Row { id: string; entity_name: string; state: State; req_shops: number; req_seats: number; req_period: string; monthly_price: number | null; currency: string | null; created_at: string; valid_until: string | null; price_until: string | null }
interface Detail {
  quote: any; entity: { name: string; plan: string; plan_expires_at: string | null } | null; used: { shops: number; seats: number }
  pricing: { country: string; country_name: string; currency: string; reason: string }
  prices: { business: number; seat: number; shop: number }; suggested_monthly: number
}
const STATE: Record<State, { label: string; cls: string }> = {
  requested: { label: 'Nouvelle', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  quoted: { label: 'Devis envoyé', cls: 'bg-stockshop-blue-muted text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-400' },
  paid: { label: 'Payé', cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  declined: { label: 'Refusée', cls: 'bg-muted text-muted-foreground' },
  expired: { label: 'Expiré', cls: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' },
  cancelled: { label: 'Annulée', cls: 'bg-muted text-muted-foreground' },
}
const PERIOD: Record<string, string> = { monthly: 'Mensuel', semiannual: '6 mois', annual: '1 an' }
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '')

export function CustomQuotesAdmin() {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [form, setForm] = useState({ monthly: '', period: 'annual', shops: '', seats: '', clientNote: '', adminNote: '' })
  const [busy, setBusy] = useState(false)
  const [whatsapp, setWhatsapp] = useState<string | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/custom-quotes'); const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Erreur de chargement')
      setRows(j.quotes); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  // keep : rechargement après une action, le texte WhatsApp reste affiché pour être copié
  const open = async (id: string, keep = false) => {
    setOpenId(id); if (!keep) { setDetail(null); setWhatsapp(null) }
    const res = await fetch(`/api/admin/custom-quotes?id=${id}`); const j = await res.json()
    if (!res.ok) { toast({ title: j.error || 'Erreur', variant: 'destructive' }); setOpenId(null); return }
    setDetail(j)
    const q = j.quote
    setForm({
      monthly: String(q.monthly_price ?? j.suggested_monthly), period: q.billing_period ?? q.req_period,
      shops: String(q.limit_shops ?? q.req_shops), seats: String(q.limit_seats ?? q.req_seats), clientNote: q.client_note ?? '', adminNote: q.admin_note ?? '',
    })
  }
  const act = async (payload: Record<string, unknown>, ok: string) => {
    if (!openId) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/custom-quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: openId, ...payload }) })
      const j = await res.json()
      if (!res.ok) { toast({ title: j.error || 'Erreur', variant: 'destructive' }); return false }
      toast({ title: ok + (j.email && j.email !== 'sent' ? ` (e-mail : ${j.email})` : ''), variant: 'success' })
      if (j.whatsapp) setWhatsapp(j.whatsapp)
      load(); open(openId, true)
      return true
    } finally { setBusy(false) }
  }

  const q = detail?.quote
  const editable = q && ['requested', 'quoted', 'expired'].includes(q.state)
  const monthly = Number(form.monthly)
  const total = monthly > 0 ? quoteTotal(monthly, form.period as any) : 0
  const cur = detail?.pricing.currency || 'XOF'
  const money = (n: number) => formatCurrency(n, cur)
  const belowSuggested = detail && monthly > 0 ? Math.round((1 - monthly / detail.suggested_monthly) * 100) : 0

  return (
    <div className="space-y-6" data-testid="custom-quotes-admin">
      <AdminPageHeader title="Devis sur mesure" description="Demandes des entreprises à partir de 4 boutiques : prix conseillé, devis par e-mail avec PDF et lien de paiement."
        actions={<Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={load}><RefreshCw className="h-4 w-4" />Actualiser</Button>} />
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-400" role="alert">{error}</p>}

      {!rows ? <Skeleton className="h-40 rounded-xl" /> : !rows.length ? (
        <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">Aucune demande pour l'instant.</p>
      ) : (
        <ul className="space-y-2" data-testid="custom-quotes-list">
          {rows.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => open(r.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-3 text-left hover:border-stockshop-blue/40" data-testid="custom-quote-row">
                <span className="min-w-0 flex-1 font-medium">{r.entity_name || 'Entreprise'}</span>
                <span className="text-sm text-muted-foreground">{r.req_shops} boutiques · {r.req_seats} employés · {PERIOD[r.req_period]}</span>
                {r.monthly_price && r.currency && <span className="text-sm font-semibold tabular-nums">{formatCurrency(Number(r.monthly_price), r.currency)} / mois</span>}
                <span className="text-xs text-muted-foreground">{fmtDate(r.created_at)}</span>
                <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATE[r.state].cls)}>{STATE[r.state].label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <AppDrawer open={!!openId} onOpenChange={o => { if (!o && !busy) setOpenId(null) }} title={detail?.entity?.name || 'Devis'} description={q ? STATE[q.state as State].label : undefined}
        icon={<FileText className="h-4 w-4" />} width="md" testId="custom-quote-drawer">
        {!detail || !q ? <Skeleton className="h-64 rounded-xl" /> : (
          <div className="space-y-5 text-sm">
            <section className="space-y-1 rounded-lg border p-3">
              <p className="font-semibold">Demande du {fmtDate(q.created_at)}</p>
              <p>{q.req_shops} boutiques, {q.req_seats} employés, {PERIOD[q.req_period]}{q.req_phone ? ` · WhatsApp ${q.req_phone}` : ''}</p>
              {q.req_needs && <p className="text-muted-foreground">« {q.req_needs} »</p>}
              <p className="text-muted-foreground">Aujourd'hui : {detail.used.shops} boutique(s), {detail.used.seats} employé(s) · formule {detail.entity?.plan} · pays de tarification {detail.pricing.country_name} ({detail.pricing.currency})</p>
            </section>
            <section className="space-y-1 rounded-lg bg-stockshop-blue-muted p-3 text-stockshop-blue dark:bg-blue-950/40 dark:text-blue-300" data-testid="custom-suggested">
              <p className="font-semibold">Prix conseillé : {money(detail.suggested_monthly)} / mois</p>
              <p className="text-xs">Business {money(detail.prices.business)} + boutiques au-delà de 3 à {money(detail.prices.shop)} + employés au-delà de 8 à {money(detail.prices.seat)}</p>
            </section>
            <fieldset disabled={!editable || busy} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Prix mensuel ({cur})</Label><Input type="number" min={1} value={form.monthly} onChange={e => setForm(f => ({ ...f, monthly: e.target.value }))} data-testid="custom-monthly" /></div>
                <div className="space-y-1"><Label>Durée</Label>
                  <select value={form.period} onChange={e => setForm(f => ({ ...f, period: e.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3">
                    {Object.entries(PERIOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></div>
                <div className="space-y-1"><Label>Boutiques</Label><Input type="number" min={1} max={200} value={form.shops} onChange={e => setForm(f => ({ ...f, shops: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Employés</Label><Input type="number" min={0} max={2000} value={form.seats} onChange={e => setForm(f => ({ ...f, seats: e.target.value }))} /></div>
              </div>
              <p className="text-sm">Total : <strong className="tabular-nums" data-testid="custom-total">{total ? money(total) : '—'}</strong> pour {PERIOD[form.period]}
                {belowSuggested > 0 && <span className={cn('ml-2 text-xs', belowSuggested > 30 ? 'text-red-600' : 'text-amber-600')}>remise de {belowSuggested} % sur le prix conseillé</span>}</p>
              <div className="space-y-1"><Label>Message au client (dans l'e-mail et le PDF)</Label><Textarea rows={2} maxLength={1000} value={form.clientNote} onChange={e => setForm(f => ({ ...f, clientNote: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Note interne</Label><Textarea rows={2} maxLength={1000} value={form.adminNote} onChange={e => setForm(f => ({ ...f, adminNote: e.target.value }))} /></div>
            </fieldset>
            {q.state === 'quoted' && <p className="text-xs text-muted-foreground">Valable jusqu'au {fmtDate(q.valid_until)}.</p>}
            {q.state === 'paid' && <p className="text-xs text-green-700 dark:text-green-400">Payé le {fmtDate(q.paid_at)} · prix garanti jusqu'au {fmtDate(q.price_until)}.</p>}
            {whatsapp && (
              <div className="space-y-2 rounded-lg border p-3" data-testid="custom-whatsapp">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Texte WhatsApp</p>
                <p className="whitespace-pre-line">{whatsapp}</p>
                <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => navigator.clipboard.writeText(whatsapp).then(() => toast({ title: 'Copié', variant: 'success' }))}><Copy className="h-4 w-4" />Copier</Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              {editable && <Button variant="stockshop" className="h-11 gap-1.5" disabled={busy || !(monthly > 0)} onClick={() => act({ action: 'send', monthly_price: monthly, billing_period: form.period, limit_shops: Number(form.shops), limit_seats: Number(form.seats), client_note: form.clientNote, admin_note: form.adminNote }, 'Devis envoyé')} data-testid="custom-send"><Send className="h-4 w-4" />{q.state === 'requested' ? 'Envoyer le devis' : 'Renvoyer le devis modifié'}</Button>}
              {['quoted', 'expired'].includes(q.state) && <Button variant="outline" className="h-11 gap-1.5" disabled={busy} onClick={() => act({ action: 'extend' }, 'Devis prolongé de 15 jours')}><CalendarPlus className="h-4 w-4" />Prolonger 15 jours</Button>}
              {editable && <Button variant="outline" className="h-11 gap-1.5 text-red-600" disabled={busy} onClick={() => { setReason(''); setDeclining(true) }}><XCircle className="h-4 w-4" />Refuser</Button>}
            </div>
          </div>
        )}
      </AppDrawer>
      <ConfirmModal open={declining} onOpenChange={setDeclining} title="Refuser la demande" description="Le client verra ce motif sur sa page Abonnement." tone="danger"
        confirmLabel="Refuser" loading={busy} disabled={reason.trim().length < 3} onConfirm={async () => { if (await act({ action: 'decline', reason }, 'Demande refusée')) setDeclining(false) }}>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motif (obligatoire)" />
      </ConfirmModal>
    </div>
  )
}
