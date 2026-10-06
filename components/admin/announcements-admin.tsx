'use client'

// Admin → Nouveautés (Nouveautés V2, lot B) : liste, éditeur en panneau,
// aperçu fidèle (mêmes composants que l'app : carte du panneau et bandeau),
// statistiques. Aucune suppression : « Désactiver » remet en brouillon.
// Toutes les écritures : /api/admin/announcements (administrateur complet, journalisé).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, Eye, EyeOff, Pencil, Plus, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormDrawer } from '@/components/ui/form-drawer'
import { DrawerSection } from '@/components/ui/app-drawer'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useToast } from '@/components/ui/use-toast'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { AnnouncementCard, PageAnnouncement } from '@/components/announcements/whats-new'
import { cn } from '@/lib/utils/cn'
import {
  ANNOUNCEMENT_PAGES, ANNOUNCEMENT_ROLES, ANNOUNCEMENT_KINDS, TITLE_MAX, DESCRIPTION_MAX,
  announcementStatus, validateAnnouncement, type AnnouncementStatus,
} from '@/lib/announcements/catalog'
import type { Announcement } from '@/lib/announcements/use-announcements'

interface Row {
  id: string; kind: 'new' | 'improvement' | 'fix'
  title: string; description: string
  title_en: string | null; description_en: string | null; title_ha: string | null; description_ha: string | null
  target_path: string | null; cta_path: string | null; roles: string[] | null
  published_at: string; expires_at: string | null; is_active: boolean
  stats?: { dismissed: number; seen: number | null }
}

type Draft = Omit<Row, 'id' | 'stats'> & { id?: string; schedule: 'now' | 'later' }

const NONE = '__none__'
const STATUS: Record<AnnouncementStatus, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'bg-muted text-muted-foreground' },
  scheduled: { label: 'Programmée', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
  live: { label: 'En ligne', cls: 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400' },
  ended: { label: 'Terminée', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
}
const pageLabel = (p: string | null) => (p ? ANNOUNCEMENT_PAGES.find(x => x.path === p)?.label ?? p : '—')
const rolesLabel = (r: string[] | null) => (!r?.length ? 'Tout le monde' : r.map(x => ANNOUNCEMENT_ROLES.find(y => y.role === x)?.label ?? x).join(', '))
const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** <input type="datetime-local"> en heure locale du navigateur */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

const emptyDraft = (): Draft => ({
  kind: 'new', title: '', description: '', title_en: null, description_en: null, title_ha: null, description_ha: null,
  target_path: null, cta_path: null, roles: null, published_at: new Date().toISOString(), expires_at: null, is_active: true, schedule: 'now',
})

export function AnnouncementsAdmin({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [initial, setInitial] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [toggling, setToggling] = useState<Row | null>(null)
  const [previewLang, setPreviewLang] = useState<'fr' | 'en' | 'ha'>('fr')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/announcements')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Erreur de chargement')
      setRows(json.announcements); setLoadError(null)
    } catch (e: any) { setLoadError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const open = (d: Draft) => { setDraft(d); setInitial(JSON.stringify(d)); setFormError(null); setPreviewLang('fr') }
  const edit = (r: Row) => open({ ...r, schedule: new Date(r.published_at).getTime() > Date.now() ? 'later' : 'now' })
  const duplicate = (r: Row) => open({ ...r, id: undefined, title: `${r.title} (copie)`.slice(0, TITLE_MAX), is_active: false, published_at: new Date().toISOString(), expires_at: null, schedule: 'now' })
  // Toute modification efface l'erreur précédente (elle sera recalculée à l'enregistrement)
  const set = (patch: Partial<Draft>) => { setFormError(null); setDraft(d => (d ? { ...d, ...patch } : d)) }

  const payload = (d: Draft) => ({
    ...(d.id ? { id: d.id } : {}),
    kind: d.kind, title: d.title, description: d.description,
    title_en: d.title_en, description_en: d.description_en, title_ha: d.title_ha, description_ha: d.description_ha,
    target_path: d.target_path, cta_path: d.cta_path, roles: d.roles,
    // « Maintenant » : la date d'origine est gardée pour une annonce déjà en ligne
    published_at: d.schedule === 'later' ? d.published_at
      : d.id && new Date(d.published_at).getTime() <= Date.now() ? d.published_at : new Date().toISOString(),
    expires_at: d.expires_at, is_active: d.is_active,
  })
  const check = draft ? validateAnnouncement(payload(draft)) : null
  const willGoLive = !!draft && draft.is_active && draft.schedule === 'now' && !(draft.expires_at && new Date(draft.expires_at).getTime() <= Date.now())

  const save = async () => {
    if (!draft) return
    const body = payload(draft)
    const { errors } = validateAnnouncement(body)
    if (errors.length) { setFormError(errors.join(' ')); return }
    setSaving(true); setFormError(null)
    try {
      const res = await fetch('/api/admin/announcements', { method: draft.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Enregistrement impossible')
      toast({ title: draft.is_active ? (willGoLive ? 'Annonce publiée' : 'Annonce programmée') : 'Brouillon enregistré', variant: 'success' })
      setDraft(null); setConfirmPublish(false); load()
    } catch (e: any) { setFormError(e.message); setConfirmPublish(false) } finally { setSaving(false) }
  }
  const submit = () => {
    if (check?.errors.length) { setFormError(check.errors.join(' ')); return }
    if (willGoLive) setConfirmPublish(true); else save()
  }

  const toggle = async () => {
    if (!toggling) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/announcements', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: toggling.id, is_active: !toggling.is_active }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Action impossible')
      toast({ title: toggling.is_active ? 'Annonce désactivée' : 'Annonce activée', variant: 'success' })
      setToggling(null); load()
    } catch (e: any) { toast({ title: e.message, variant: 'destructive' }) } finally { setSaving(false) }
  }

  // Aperçu : l'annonce telle que l'utilisateur la verra, dans la langue choisie (repli : français)
  const preview: Announcement | null = useMemo(() => {
    if (!draft) return null
    const t = previewLang === 'en' ? draft.title_en : previewLang === 'ha' ? draft.title_ha : null
    const d = previewLang === 'en' ? draft.description_en : previewLang === 'ha' ? draft.description_ha : null
    return {
      id: 'preview', kind: draft.kind, title: t || draft.title || 'Titre de l’annonce', description: d || draft.description || 'Texte de l’annonce.',
      ctaPath: draft.cta_path, targetPath: draft.target_path, publishedAt: payload(draft).published_at, unread: true,
    }
  }, [draft, previewLang]) // eslint-disable-line react-hooks/exhaustive-deps

  const counter = (v: string | null, max: number) => <span className={cn('text-[11px] tabular-nums', (v?.length ?? 0) > max ? 'text-red-600' : 'text-muted-foreground')}>{v?.length ?? 0}/{max}</span>

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader
        title="Nouveautés"
        description="Annonces affichées dans l’app : panneau Nouveautés, bandeau sur la page concernée, badge du menu."
        actions={canEdit ? <Button variant="stockshop" className="gap-2" onClick={() => open(emptyDraft())} data-testid="ann-new"><Plus className="h-4 w-4" />Nouvelle annonce</Button> : undefined}
      />

      {loadError ? <p className="rounded-xl border bg-card p-6 text-sm text-red-600">{loadError}</p>
        : !rows ? <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
        : !rows.length ? <p className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Aucune annonce.</p>
        : (
          <ul className="space-y-3" data-testid="ann-list">
            {rows.map(r => {
              const st = STATUS[announcementStatus(r)]
              return (
                <li key={r.id} className="rounded-xl border bg-card p-4 shadow-sm" data-testid="ann-row">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', st.cls)} data-testid="ann-status">{st.label}</span>
                        <span className="text-xs text-muted-foreground">{ANNOUNCEMENT_KINDS.find(k => k.kind === r.kind)?.label}</span>
                        <span className="flex gap-1">{(['fr', 'en', 'ha'] as const).map(l => {
                          const has = l === 'fr' || (l === 'en' ? !!r.title_en : !!r.title_ha)
                          return <span key={l} className={cn('rounded border px-1 text-[10px] uppercase', has ? 'text-foreground' : 'text-muted-foreground/50 line-through')}>{l}</span>
                        })}</span>
                      </div>
                      <p className="mt-1.5 break-words font-semibold">{r.title}</p>
                      <p className="mt-0.5 line-clamp-2 break-words text-sm text-muted-foreground">{r.description}</p>
                      <dl className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-muted-foreground sm:grid-cols-2">
                        <div><dt className="inline">Publication : </dt><dd className="inline text-foreground">{fmtDate(r.published_at)}</dd>{r.expires_at && <> · fin {fmtDate(r.expires_at)}</>}</div>
                        <div><dt className="inline">Public : </dt><dd className="inline text-foreground">{rolesLabel(r.roles)}</dd></div>
                        <div><dt className="inline">Page : </dt><dd className="inline text-foreground">{pageLabel(r.target_path)}</dd> · Essayer → {pageLabel(r.cta_path)}</div>
                        <div data-testid="ann-stats"><dt className="inline">Vue (estimation) : </dt><dd className="inline text-foreground">{r.stats?.seen ?? '—'}</dd> · bandeau fermé : <span className="text-foreground">{r.stats?.dismissed ?? 0}</span></div>
                      </dl>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => edit(r)} data-testid="ann-edit"><Pencil className="h-3.5 w-3.5" />Modifier</Button>
                        <Button variant="outline" size="icon" className="h-9 w-9" title="Dupliquer" aria-label="Dupliquer" onClick={() => duplicate(r)}><Copy className="h-3.5 w-3.5" /></Button>
                        <Button variant="outline" size="icon" className="h-9 w-9" title={r.is_active ? 'Désactiver' : 'Activer'} aria-label={r.is_active ? 'Désactiver' : 'Activer'} onClick={() => setToggling(r)} data-testid="ann-toggle">
                          {r.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

      {draft && (
        <FormDrawer
          open={!!draft}
          onOpenChange={o => { if (!o) setDraft(null) }}
          category="Nouveautés"
          title={draft.id ? 'Modifier l’annonce' : 'Nouvelle annonce'}
          icon={<Sparkles className="h-4 w-4" />}
          width="xl"
          dirty={JSON.stringify(draft) !== initial}
          onSubmit={submit}
          submitting={saving}
          submitLabel={!draft.is_active ? 'Enregistrer le brouillon' : willGoLive ? 'Publier' : 'Programmer'}
          submitIcon={draft.is_active ? <Send className="h-4 w-4" /> : undefined}
          error={formError}
          testId="ann-editor"
        >
          <DrawerSection title="Type">
            <div className="flex flex-wrap gap-2">
              {ANNOUNCEMENT_KINDS.map(k => (
                <button key={k.kind} type="button" onClick={() => set({ kind: k.kind })} aria-pressed={draft.kind === k.kind}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm', draft.kind === k.kind ? 'border-stockshop-blue bg-stockshop-blue-muted font-medium text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted/50')}>
                  {k.label}
                </button>
              ))}
            </div>
          </DrawerSection>

          {([['fr', 'Français (obligatoire)', 'title', 'description'], ['en', 'Anglais (facultatif — sinon le français est affiché)', 'title_en', 'description_en'], ['ha', 'Haoussa (facultatif — à faire relire)', 'title_ha', 'description_ha']] as const).map(([lang, label, tk, dk]) => (
            <DrawerSection key={lang} title={label} collapsible={lang !== 'fr'} defaultOpen={lang === 'fr' || !!draft[tk]}>
              <div className="space-y-3">
                <div className="space-y-1">
                  <div className="flex justify-between"><Label htmlFor={`ann-${tk}`}>Titre</Label>{counter(draft[tk], TITLE_MAX)}</div>
                  <Input id={`ann-${tk}`} value={draft[tk] ?? ''} onChange={e => set({ [tk]: lang === 'fr' ? e.target.value : e.target.value || null } as any)} maxLength={TITLE_MAX + 20} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between"><Label htmlFor={`ann-${dk}`}>Texte</Label>{counter(draft[dk], DESCRIPTION_MAX)}</div>
                  <Textarea id={`ann-${dk}`} rows={3} value={draft[dk] ?? ''} onChange={e => set({ [dk]: lang === 'fr' ? e.target.value : e.target.value || null } as any)} maxLength={DESCRIPTION_MAX + 50} />
                </div>
              </div>
            </DrawerSection>
          ))}

          <DrawerSection title="Où et pour qui">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Page du bandeau</Label>
                <Select value={draft.target_path ?? NONE} onValueChange={v => set({ target_path: v === NONE ? null : v })}>
                  <SelectTrigger data-testid="ann-target"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Aucune (panneau seulement)</SelectItem>
                    {ANNOUNCEMENT_PAGES.map(p => <SelectItem key={p.path} value={p.path}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Lien « Essayer »</Label>
                <Select value={draft.cta_path ?? NONE} onValueChange={v => set({ cta_path: v === NONE ? null : v })}>
                  <SelectTrigger data-testid="ann-cta"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Aucun</SelectItem>
                    {ANNOUNCEMENT_PAGES.map(p => <SelectItem key={p.path} value={p.path}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              <Label>Public</Label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => set({ roles: null })} aria-pressed={!draft.roles}
                  className={cn('rounded-full border px-3 py-1 text-xs', !draft.roles ? 'border-stockshop-blue bg-stockshop-blue-muted font-medium text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted/50')}>Tout le monde</button>
                {ANNOUNCEMENT_ROLES.map(r => {
                  const on = !!draft.roles?.includes(r.role)
                  return (
                    <button key={r.role} type="button" aria-pressed={on} data-testid={`ann-role-${r.role}`}
                      onClick={() => { const next = on ? (draft.roles || []).filter(x => x !== r.role) : [...(draft.roles || []), r.role]; set({ roles: next.length ? next : null }) }}
                      className={cn('rounded-full border px-3 py-1 text-xs', on ? 'border-stockshop-blue bg-stockshop-blue-muted font-medium text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted/50')}>{r.label}</button>
                  )
                })}
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Publication">
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <span className="text-sm"><span className="font-medium">Active</span><span className="block text-xs text-muted-foreground">Désactivée = brouillon, invisible des utilisateurs</span></span>
                <Switch checked={draft.is_active} onCheckedChange={v => set({ is_active: v })} data-testid="ann-active" />
              </label>
              <div className="flex flex-wrap gap-2">
                {([['now', 'Dès l’enregistrement'], ['later', 'À une date']] as const).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={draft.schedule === v} onClick={() => set({ schedule: v, ...(v === 'later' && new Date(draft.published_at).getTime() <= Date.now() ? { published_at: new Date(Date.now() + 86_400_000).toISOString() } : {}) })}
                    className={cn('rounded-lg border px-3 py-1.5 text-sm', draft.schedule === v ? 'border-stockshop-blue bg-stockshop-blue-muted font-medium text-stockshop-blue dark:border-blue-500 dark:bg-blue-950/40 dark:text-blue-300' : 'hover:bg-muted/50')}>{l}</button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {draft.schedule === 'later' && (
                  <div className="space-y-1">
                    <Label htmlFor="ann-pub">Publication (heure de ce navigateur)</Label>
                    <Input id="ann-pub" type="datetime-local" value={toLocalInput(draft.published_at)} onChange={e => set({ published_at: fromLocalInput(e.target.value) ?? draft.published_at })} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="ann-exp">Fin (facultative)</Label>
                  <div className="flex gap-1.5">
                    <Input id="ann-exp" type="datetime-local" value={toLocalInput(draft.expires_at)} onChange={e => set({ expires_at: fromLocalInput(e.target.value) })} />
                    {draft.expires_at && <Button type="button" variant="ghost" size="icon" className="h-10 w-10" aria-label="Retirer la fin" onClick={() => set({ expires_at: null })}><X className="h-4 w-4" /></Button>}
                  </div>
                </div>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Aperçu" description="Exactement comme les utilisateurs le verront">
            <div className="mb-3 flex gap-1 rounded-lg border bg-muted/30 p-1 sm:w-fit">
              {(['fr', 'en', 'ha'] as const).map(l => (
                <button key={l} type="button" onClick={() => setPreviewLang(l)} className={cn('rounded-md px-3 py-1 text-xs font-medium uppercase', previewLang === l ? 'bg-background shadow-sm' : 'text-muted-foreground')}>{l}</button>
              ))}
            </div>
            {preview && (
              <div className="space-y-3" data-testid="ann-preview">
                <p className="text-xs font-medium text-muted-foreground">Panneau Nouveautés</p>
                <ol><AnnouncementCard item={preview} /></ol>
                {draft.target_path ? (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Bandeau sur « {pageLabel(draft.target_path)} »</p>
                    <PageAnnouncement item={preview} currentPath={draft.target_path} onDismiss={() => {}} preview />
                  </>
                ) : <p className="text-xs text-muted-foreground">Pas de bandeau : aucune page choisie.</p>}
              </div>
            )}
          </DrawerSection>
        </FormDrawer>
      )}

      <ConfirmModal
        open={confirmPublish}
        onOpenChange={o => { if (!o && !saving) setConfirmPublish(false) }}
        category="Nouveautés"
        title="Publier maintenant ?"
        description={`L’annonce sera visible immédiatement par : ${rolesLabel(draft?.roles ?? null)}.`}
        icon={<Send className="h-4 w-4" />}
        confirmLabel="Publier"
        loading={saving}
        onConfirm={save}
      />
      <ConfirmModal
        open={!!toggling}
        onOpenChange={o => { if (!o && !saving) setToggling(null) }}
        category="Nouveautés"
        title={toggling?.is_active ? 'Désactiver cette annonce ?' : 'Activer cette annonce ?'}
        description={toggling?.is_active ? 'Elle disparaît de l’app pour tout le monde. Elle reste ici, en brouillon, et peut être réactivée.' : 'Elle redevient visible selon sa date de publication et son public.'}
        tone={toggling?.is_active ? 'danger' : 'primary'}
        confirmLabel={toggling?.is_active ? 'Désactiver' : 'Activer'}
        loading={saving}
        onConfirm={toggle}
      />
    </div>
  )
}
