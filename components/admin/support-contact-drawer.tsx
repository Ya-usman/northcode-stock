'use client'

// Admin → Activation : écrire à un commerçant qui débute. Message prêt à
// l'envoi selon sa situation (modèle conseillé), dans SA langue, modifiable ;
// envoi depuis support@stockshop.tech (réponses au support), ou ouverture dans
// WhatsApp, ou copie. Un 2e message en moins de 2 jours demande confirmation.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Copy, History, Mail, MessageCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { BODY_MAX, RECONTACT_GAP_MS, SUBJECT_MAX, whatsappUrl, type SupportTemplate } from '@/lib/support/contact'

const TEMPLATE_LABEL: Record<SupportTemplate, string> = {
  welcome_product: 'Bienvenue · premier produit',
  late_product: 'Aide au démarrage · produits',
  first_sale: 'Première vente',
  free: 'Message libre',
}
const LANG_LABEL: Record<string, string> = { fr: 'Français', en: 'Anglais', ha: 'Haoussa (texte à relire)' }
const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

interface Preview {
  owner: { id: string; name: string | null; email: string | null; phone: string | null; shopName: string }
  locale: string; template: SupportTemplate; recommended: SupportTemplate
  subject: string; body: string; hasWhatsapp: boolean; unsubscribed: boolean; from: string; sender: string
  history: { id: string; channel: 'email' | 'whatsapp'; subject: string | null; created_at: string; sent_by_name: string | null }[]
}

export function SupportContactDrawer({ ownerId, onOpenChange, onSent }: { ownerId: string | null; onOpenChange: (o: boolean) => void; onSent: () => void }) {
  const { toast } = useToast()
  const [p, setP] = useState<Preview | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [pendingTemplate, setPendingTemplate] = useState<SupportTemplate | null>(null)
  const [confirm, setConfirm] = useState<null | { channel: 'email' | 'whatsapp'; last: Preview['history'][number] }>(null)
  // Signature (prénom) : retenue sur cet ordinateur ; à défaut, le prénom du profil admin
  const [sender, setSender] = useState('')
  useEffect(() => { try { setSender(localStorage.getItem('support_sender') || '') } catch { /* stockage indisponible */ } }, [])

  const load = useCallback(async (id: string, template?: SupportTemplate, signer?: string) => {
    setLoadError(null)
    try {
      const qs = new URLSearchParams({ owner: id, ...(template ? { template } : {}), ...(signer?.trim() ? { sender: signer.trim() } : {}) })
      const res = await fetch(`/api/admin/support-contact?${qs}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Chargement impossible')
      setP(json); setSubject(json.subject); setBody(json.body); setSender(json.sender); setError(null)
    } catch (e: any) { setLoadError(e.message) }
  }, [])
  useEffect(() => {
    setP(null)
    if (!ownerId) return
    let saved = ''
    try { saved = localStorage.getItem('support_sender') || '' } catch { /* idem */ }
    load(ownerId, undefined, saved)
  }, [ownerId, load])

  // Nouvelle signature : retenue, et le texte est refait s'il n'a pas été modifié à la main
  const applySender = () => {
    if (!p || !sender.trim() || sender.trim() === p.sender) return
    try { localStorage.setItem('support_sender', sender.trim()) } catch { /* idem */ }
    if (!edited) load(p.owner.id, p.template, sender)
  }

  const edited = !!p && (subject !== p.subject || body !== p.body)
  const recent = p?.history[0] && Date.now() - new Date(p.history[0].created_at).getTime() < RECONTACT_GAP_MS ? p.history[0] : null

  const changeTemplate = (t: SupportTemplate) => {
    if (!p || t === p.template) return
    if (edited) setPendingTemplate(t) // le texte modifié serait perdu : on demande
    else load(p.owner.id, t, sender)
  }

  const post = async (channel: 'email' | 'whatsapp', force: boolean) => {
    if (!p) return
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/admin/support-contact', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner_id: p.owner.id, template: p.template, subject, body, channel, force, sender: sender.trim() || undefined }),
      })
      const json = await res.json()
      if (res.status === 409 && json.code === 'recent_contact') { setConfirm({ channel, last: json.last }); return }
      if (!res.ok) throw new Error(json.error || 'Envoi impossible')
      toast({ title: channel === 'email' ? `Message envoyé à ${p.owner.email}` : 'Contact WhatsApp noté', variant: 'success' })
      onSent(); onOpenChange(false)
    } catch (e: any) { setError(e.message) } finally { setSending(false) }
  }

  const sendEmail = () => (recent ? setConfirm({ channel: 'email', last: recent }) : post('email', false))
  // WhatsApp s'ouvre DANS le clic (sinon le navigateur bloque la fenêtre), puis le contact est noté
  const openWhatsapp = (force = false) => {
    if (!p) return
    if (recent && !force) { setConfirm({ channel: 'whatsapp', last: recent }); return }
    const url = whatsappUrl(p.owner.phone, body)
    if (!url) return
    window.open(url, '_blank', 'noopener')
    post('whatsapp', true)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); toast({ title: 'Message copié', variant: 'success' }) }
    catch { toast({ title: 'Copie impossible', variant: 'destructive' }) }
  }

  const tooLong = body.length > BODY_MAX || subject.length > SUBJECT_MAX
  return (
    <>
      <FormDrawer
        open={!!ownerId}
        onOpenChange={onOpenChange}
        category="Support"
        title={p ? `Écrire à ${p.owner.name || p.owner.shopName}` : 'Écrire au commerçant'}
        description={p ? `${p.owner.shopName} · depuis support@stockshop.tech` : undefined}
        icon={<Mail className="h-4 w-4" />}
        width="lg"
        dirty={edited}
        onSubmit={sendEmail}
        submitting={sending}
        submitLabel="Envoyer l’e-mail"
        submitIcon={<Send className="h-4 w-4" />}
        submitDisabled={!p || !p.owner.email || tooLong || body.trim().length < 20}
        error={error}
        footerExtra={p && (
          <div className="flex flex-wrap gap-2">
            {p.hasWhatsapp && <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => openWhatsapp()} disabled={sending} data-testid="sc-whatsapp"><MessageCircle className="h-4 w-4" />Ouvrir dans WhatsApp</Button>}
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5" onClick={copy} data-testid="sc-copy"><Copy className="h-4 w-4" />Copier le message</Button>
          </div>
        )}
        testId="support-contact-drawer"
      >
        {loadError ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{loadError}</p> : !p ? (
          <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
        ) : (
          <div className="space-y-4">
            <DrawerSection title="Destinataire">
              <dl className="grid gap-1 text-sm">
                <div><dt className="inline text-muted-foreground">À : </dt><dd className="inline break-all">{p.owner.email || <span className="text-red-600 dark:text-red-400">aucune adresse e-mail</span>}</dd></div>
                <div><dt className="inline text-muted-foreground">WhatsApp : </dt><dd className="inline">{p.hasWhatsapp ? p.owner.phone : 'aucun numéro enregistré'}</dd></div>
                <div><dt className="inline text-muted-foreground">Langue du message : </dt><dd className="inline">{LANG_LABEL[p.locale] ?? p.locale}</dd></div>
                <div><dt className="inline text-muted-foreground">De : </dt><dd className="inline break-all">{(sender.trim() || p.sender)} — StockShop &lt;support@stockshop.tech&gt;</dd></div>
              </dl>
              <div className="mt-3 space-y-1">
                <Label htmlFor="sc-sender">Signature (votre prénom)</Label>
                <Input id="sc-sender" value={sender} onChange={e => setSender(e.target.value)} onBlur={applySender} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applySender() } }} maxLength={40} className="max-w-xs" data-testid="sc-sender" />
                <p className="text-xs text-muted-foreground">Retenue sur cet ordinateur. Utilisée pour l’expéditeur et la signature du message.</p>
              </div>
              {p.unsubscribed && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />Ce commerçant s’est désinscrit des conseils automatiques. Un message personnel reste possible : à garder ponctuel.
                </p>
              )}
              {p.history.length > 0 && (
                <div className="mt-3" data-testid="sc-history">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><History className="h-3.5 w-3.5" />Déjà contacté</p>
                  <ul className="space-y-0.5 text-xs">{p.history.map(h => <li key={h.id}>{fmt(h.created_at)} · {h.channel === 'email' ? 'e-mail' : 'WhatsApp'}{h.sent_by_name ? ` · par ${h.sent_by_name}` : ''}{h.subject ? ` · « ${h.subject} »` : ''}</li>)}</ul>
                </div>
              )}
            </DrawerSection>

            <DrawerSection title="Message">
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Modèle</Label>
                  <Select value={p.template} onValueChange={v => changeTemplate(v as SupportTemplate)}>
                    <SelectTrigger data-testid="sc-template"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TEMPLATE_LABEL) as SupportTemplate[]).map(t => <SelectItem key={t} value={t}>{TEMPLATE_LABEL[t]}{t === p.recommended ? ' (conseillé)' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label htmlFor="sc-subject">Objet de l’e-mail</Label><span className="text-xs text-muted-foreground">{subject.length}/{SUBJECT_MAX}</span></div>
                  <Input id="sc-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={SUBJECT_MAX} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label htmlFor="sc-body">Texte</Label><span className="text-xs text-muted-foreground">{body.length}/{BODY_MAX}</span></div>
                  <Textarea id="sc-body" value={body} onChange={e => setBody(e.target.value)} rows={16} className="font-[inherit] text-sm leading-relaxed" data-testid="sc-body" />
                  <p className="text-xs text-muted-foreground">Le lien seul sur sa ligne devient un bouton dans l’e-mail. Les réponses arrivent sur support@stockshop.tech.</p>
                </div>
              </div>
            </DrawerSection>
          </div>
        )}
      </FormDrawer>

      <ConfirmModal
        open={!!pendingTemplate}
        onOpenChange={o => { if (!o) setPendingTemplate(null) }}
        category="Support"
        title="Remplacer le texte ?"
        description="Vos modifications seront perdues et remplacées par le modèle choisi."
        confirmLabel="Remplacer"
        onConfirm={() => { if (p && pendingTemplate) load(p.owner.id, pendingTemplate, sender); setPendingTemplate(null) }}
      />
      <ConfirmModal
        open={!!confirm}
        onOpenChange={o => { if (!o) setConfirm(null) }}
        category="Support"
        title="Déjà contacté récemment"
        description={confirm ? `Ce commerçant a été contacté le ${fmt(confirm.last.created_at)}${(confirm.last as any).sent_by_name ? ` par ${(confirm.last as any).sent_by_name}` : ''}. Envoyer quand même un nouveau message ?` : ''}
        confirmLabel="Envoyer quand même"
        onConfirm={() => { const c = confirm; setConfirm(null); if (!c) return; if (c.channel === 'whatsapp') openWhatsapp(true); else post('email', true) }}
      />
    </>
  )
}
