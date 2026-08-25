'use client'

import { useState, useEffect, useRef } from 'react'
import { usePersistedFilters } from '@/lib/hooks/use-persisted-filters'
import { createClient } from '@/lib/supabase/client'
import { useAuthContext as useAuth } from '@/lib/contexts/auth-context'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PremiumDialog, PremiumDialogBody, PremiumDialogFooter } from '@/components/ui/premium-dialog'
import { ShopSelector } from '@/components/layout/shop-selector'
import { cn } from '@/lib/utils/cn'
import { Plus, Pin, Pencil, Trash2, Store, Search, PinOff } from 'lucide-react'
import { normalize } from '@/lib/utils/normalize'
import { format } from 'date-fns'
import type { Locale } from 'date-fns'
import { fr, enUS } from 'date-fns/locale'
import { setPageCache, getPageCache } from '@/lib/offline/page-cache'
import { useOffline } from '@/lib/offline/use-offline'
import { useRefetchOnReconnect } from '@/lib/hooks/use-refetch-on-reconnect'
import { useRefetchOnVisible } from '@/lib/hooks/use-refetch-on-visible'
import { withTimeout } from '@/lib/utils/with-timeout'
import { useTranslations, useLocale } from 'next-intl'

const supabase = createClient() as any

interface Note {
  id: string
  shop_id: string
  owner_id: string
  title: string | null
  content: string
  color: string
  pinned: boolean
  created_at: string
  updated_at: string
}

const COLOR_KEYS = ['default', 'yellow', 'blue', 'green', 'pink', 'purple'] as const

const COLOR_STYLES: Record<typeof COLOR_KEYS[number], { bg: string; border: string }> = {
  default: { bg: 'bg-card',           border: 'border-border' },
  yellow:  { bg: 'bg-yellow-50 dark:bg-yellow-950/40',  border: 'border-yellow-200 dark:border-yellow-800' },
  blue:    { bg: 'bg-blue-50 dark:bg-blue-950/40',      border: 'border-blue-200 dark:border-blue-800' },
  green:   { bg: 'bg-green-50 dark:bg-green-950/40',    border: 'border-green-200 dark:border-green-800' },
  pink:    { bg: 'bg-pink-50 dark:bg-pink-950/40',      border: 'border-pink-200 dark:border-pink-800' },
  purple:  { bg: 'bg-purple-50 dark:bg-purple-950/40',  border: 'border-purple-200 dark:border-purple-800' },
}

function colorFor(key: string) {
  return COLOR_STYLES[key as typeof COLOR_KEYS[number]] ?? COLOR_STYLES.default
}

export default function NotesPage() {
  const t = useTranslations('notes')
  const tRoot = useTranslations()
  const locale = useLocale()
  const dateFnsLocale = locale === 'fr' ? fr : enUS
  const COLORS = COLOR_KEYS.map(key => ({ key, ...COLOR_STYLES[key], label: t(`color_${key}`) }))
  const { profile, shop, userShops, effectiveShopIds } = useAuth()
  const { isOnline } = useOffline()
  const { toast } = useToast()

  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [{ search }, setFilter] = usePersistedFilters(
    'notes', shop?.id, { search: '' }
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Note | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Form state
  const [color, setColor]     = useState('default')
  const [pinned, setPinned]   = useState(false)
  const [noteShop, setNoteShop] = useState(shop?.id ?? '')
  const titleRef    = useRef<HTMLInputElement>(null)
  const contentRef  = useRef<HTMLTextAreaElement>(null)
  // Both title and content are uncontrolled — avoids Android IME re-render interrupting suggestions
  const contentValueRef = useRef('')

  const fetchNotes = async () => {
    if (!effectiveShopIds.length) return
    const cacheKey = `notes_${effectiveShopIds.join(',')}`
    const cached = getPageCache<Note[]>(cacheKey)
    if (cached) { setNotes(cached); setLoading(false) }
    else setLoading(true)
    try {
      const q = supabase
        .from('notes')
        .select('*')
        .in('shop_id', effectiveShopIds)
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false })
      // Bounded so a stale connection/session after the app sat backgrounded
      // a while can never leave `loading` stuck true forever.
      const { data, error } = await withTimeout<any>(q, 20_000, t('load_timeout'))
      // A transient auth/RLS hiccup can resolve with data: null instead of
      // throwing — check explicitly so the catch below preserves the cache
      // already on screen instead of zeroing it out.
      if (error) throw error
      setNotes((data || []) as Note[])
      setPageCache(cacheKey, data || [])
    } catch {
      // cache already applied if available
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchNotes() }, [effectiveShopIds.join(',')])

  // Refresh when the user comes back to this tab — catches notes added/edited
  // by other team members in the meantime.
  useRefetchOnVisible(fetchNotes)
  useRefetchOnReconnect(fetchNotes, isOnline)

  const openCreate = () => {
    setEditing(null)
    contentValueRef.current = ''
    setColor('default')
    setPinned(false)
    setNoteShop(shop?.id ?? effectiveShopIds[0] ?? '')
    setModalOpen(true)
    setTimeout(() => {
      if (titleRef.current) titleRef.current.value = ''
      if (contentRef.current) {
        contentRef.current.value = ''
        contentRef.current.focus()
      }
    }, 100)
  }

  const openEdit = (note: Note) => {
    setEditing(note)
    contentValueRef.current = note.content
    setColor(note.color)
    setPinned(note.pinned)
    setNoteShop(note.shop_id)
    setModalOpen(true)
    // Pré-chauffe la session Supabase pendant que l'utilisateur édite
    supabase.auth.getSession().catch(() => {})
    setTimeout(() => {
      if (titleRef.current) titleRef.current.value = note.title ?? ''
      if (contentRef.current) contentRef.current.value = note.content
    }, 50)
  }

  const closeModal = () => { setModalOpen(false); setEditing(null) }

  const save = async () => {
    // Read directly from DOM refs — bypasses Android IME/onChange sync issues
    const currentContent = contentRef.current?.value ?? contentValueRef.current
    const currentTitle   = titleRef.current?.value ?? ''
    if (!currentContent.trim() && !currentTitle.trim()) return
    setSaving(true)
    // Rafraîchir le token avant d'écrire (JWT expiré → auth.uid() null → RLS violation).
    // Timeout 3s : si la connexion est morte après background, on ne bloque pas indéfiniment.
    await Promise.race([
      supabase.auth.refreshSession(),
      new Promise(r => setTimeout(r, 3_000)),
    ]).catch(() => {})
    const payload = {
      shop_id: noteShop,
      owner_id: profile!.id,
      title: currentTitle.trim() || null,
      content: currentContent.trim(),
      color,
      pinned,
    }
    try {
      if (editing) {
        const { error } = await withTimeout<any>(
          supabase.from('notes').update(payload).eq('id', editing.id),
          15_000
        )
        if (error) throw new Error(error.message)
        toast({ title: t('updated_toast'), variant: 'success' })
      } else {
        const { error } = await withTimeout<any>(
          supabase.from('notes').insert(payload),
          15_000
        )
        if (error) throw new Error(error.message)
        toast({ title: t('created_toast'), variant: 'success' })
      }
      closeModal()
      fetchNotes()
    } catch (err: any) {
      toast({ title: err.message || tRoot('toast.retry_error'), variant: 'destructive' })
      // La requête a peut-être abouti malgré le timeout — on rafraîchit quand même
      setTimeout(() => fetchNotes(), 3_000)
    } finally {
      setSaving(false)
    }
  }

  const togglePin = async (note: Note, e: React.MouseEvent) => {
    e.stopPropagation()
    await Promise.race([supabase.auth.refreshSession(), new Promise(r => setTimeout(r, 3_000))]).catch(() => {})
    const { error } = await supabase.from('notes').update({ pinned: !note.pinned }).eq('id', note.id)
    if (!error) fetchNotes()
  }

  const deleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleting(id)
    try {
      await Promise.race([supabase.auth.refreshSession(), new Promise(r => setTimeout(r, 3_000))]).catch(() => {})
      const { error } = await supabase.from('notes').delete().eq('id', id)
      if (error) throw new Error(error.message)
      setNotes(prev => prev.filter(n => n.id !== id))
      toast({ title: t('deleted_toast'), variant: 'success' })
    } catch {
      toast({ title: tRoot('toast.retry_error'), variant: 'destructive' })
    } finally {
      setDeleting(null)
    }
  }

  const filtered = notes.filter(n => {
    if (!search) return true
    const q = search.toLowerCase()
    return normalize(n.title ?? '').includes(normalize(q)) || normalize(n.content).includes(normalize(q))
  })

  const pinned_notes  = filtered.filter(n => n.pinned)
  const regular_notes = filtered.filter(n => !n.pinned)

  const shopName = (shopId: string) => userShops.find(s => s.id === shopId)?.name ?? ''

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('search_placeholder')}
            value={search}
            onChange={e => setFilter({ search: e.target.value })}
            className="pl-9"
          />
        </div>

        <ShopSelector variant="compact" className="w-auto" />

        <Button variant="stockshop" onClick={openCreate} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          {t('new_note')}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl border bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Pencil className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-medium text-foreground">{t('empty_title')}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? t('empty_no_results') : t('empty_create_hint')}
          </p>
        </div>
      )}

      {/* Pinned */}
      {pinned_notes.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
            {t('pinned_section')}
          </p>
          <NoteGrid notes={pinned_notes} onEdit={openEdit} onPin={togglePin} onDelete={deleteNote} deleting={deleting} shopName={shopName} multiShop={userShops.length > 1} dateFnsLocale={dateFnsLocale} />
        </div>
      )}

      {/* Regular */}
      {regular_notes.length > 0 && (
        <div className="space-y-2">
          {pinned_notes.length > 0 && (
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1">
              {t('other_section')}
            </p>
          )}
          <NoteGrid notes={regular_notes} onEdit={openEdit} onPin={togglePin} onDelete={deleteNote} deleting={deleting} shopName={shopName} multiShop={userShops.length > 1} dateFnsLocale={dateFnsLocale} />
        </div>
      )}

      {/* Modal */}
      <PremiumDialog open={modalOpen} onOpenChange={v => { if (!v) closeModal() }} title={editing ? t('edit_title') : t('new_note')}>
        <PremiumDialogBody>
          <div className="space-y-3">
            {/* Title — uncontrolled to prevent re-render from killing Android IME suggestions */}
            <Input
              ref={titleRef}
              placeholder={t('title_placeholder')}
              defaultValue=""
              inputMode="text"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={true}
              className="font-medium"
            />

            {/* Content — uncontrolled to preserve Android IME suggestions */}
            <textarea
              ref={contentRef}
              placeholder={t('content_placeholder')}
              defaultValue={editing?.content ?? ''}
              onInput={e => { contentValueRef.current = (e.target as HTMLTextAreaElement).value }}
              rows={6}
              inputMode="text"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={true}
              className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            {/* Color picker */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t('color_label')}</p>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c.key}
                    onClick={() => setColor(c.key)}
                    title={c.label}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-transform',
                      c.bg.split(' ')[0].replace('bg-', 'bg-').replace('50', '200').replace('/40', ''),
                      color === c.key ? 'border-foreground scale-110' : 'border-transparent hover:scale-105'
                    )}
                    style={{
                      backgroundColor: c.key === 'default' ? 'hsl(var(--card))' :
                        c.key === 'yellow' ? '#fef08a' : c.key === 'blue' ? '#bfdbfe' :
                        c.key === 'green' ? '#bbf7d0' : c.key === 'pink' ? '#fbcfe8' : '#e9d5ff'
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Shop + Pin row */}
            <div className="flex items-center gap-3">
              {userShops.length > 1 && (
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">{t('shop_label')}</p>
                  <select
                    value={noteShop}
                    onChange={e => setNoteShop(e.target.value)}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {userShops.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={cn('flex items-center gap-2', userShops.length <= 1 && 'mt-4')}>
                <button
                  onClick={() => setPinned(p => !p)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                    pinned
                      ? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                      : 'border-border text-muted-foreground hover:bg-accent'
                  )}
                >
                  <Pin className="h-3.5 w-3.5" />
                  {pinned ? t('pinned_label') : t('pin_label')}
                </button>
              </div>
            </div>
          </div>
        </PremiumDialogBody>
        <PremiumDialogFooter
          onCancel={closeModal}
          onConfirm={save}
          confirmLabel={editing ? tRoot('actions.edit') : t('create_button')}
          confirmDisabled={saving}
          confirmLoading={saving}
        />
      </PremiumDialog>
    </div>
  )
}

function NoteGrid({ notes, onEdit, onPin, onDelete, deleting, shopName, multiShop, dateFnsLocale }: {
  notes: Note[]
  onEdit: (n: Note) => void
  onPin: (n: Note, e: React.MouseEvent) => void
  onDelete: (id: string, e: React.MouseEvent) => void
  deleting: string | null
  shopName: (id: string) => string
  multiShop: boolean
  dateFnsLocale: Locale
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {notes.map(note => {
        const c = colorFor(note.color)
        return (
          <div
            key={note.id}
            onClick={() => onEdit(note)}
            className={cn(
              'group relative rounded-xl border p-4 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5',
              c.bg, c.border
            )}
          >
            {/* Actions */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                onClick={e => onPin(note, e)}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  note.pinned
                    ? 'text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10'
                )}
              >
                {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={e => onDelete(note.id, e)}
                disabled={deleting === note.id}
                className="rounded-md p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Pin badge — desktop only (mobile shows PinOff button in actions) */}
            {note.pinned && (
              <Pin className="hidden sm:block absolute top-3 right-3 h-3 w-3 text-amber-500 group-hover:opacity-0 transition-opacity" />
            )}

            {/* Title */}
            {note.title && (
              <p className="font-semibold text-sm text-foreground mb-2 pr-6 line-clamp-1">
                {note.title}
              </p>
            )}

            {/* Content */}
            <p className={cn(
              'text-sm text-foreground/80 whitespace-pre-wrap break-words',
              note.title ? 'line-clamp-5' : 'line-clamp-6'
            )}>
              {note.content}
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-black/5 dark:border-white/10">
              {multiShop && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Store className="h-3 w-3" />
                  {shopName(note.shop_id)}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                {format(new Date(note.updated_at), 'd MMM', { locale: dateFnsLocale })}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
